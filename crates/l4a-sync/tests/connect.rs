use iroh::{endpoint::presets::Minimal, SecretKey};
use l4a_sync::Node;
use std::time::Duration;

async fn node() -> anyhow::Result<Node> {
    Node::start(SecretKey::generate(), Minimal).await
}

/// Waits (up to two seconds) for something to become true.
async fn eventually(mut check: impl FnMut() -> bool) -> bool {
    for _ in 0..200 {
        if check() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    check()
}

#[tokio::test]
async fn copies_catch_up_then_stay_in_sync_live() -> anyhow::Result<()> {
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?);
    let (a, b) = (node().await?, node().await?);
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    let pb = b.open("paper", b"secret", dirs.1.path())?;
    a.write("paper", b"written before they met".to_vec())?;
    b.write("paper", b"and here too".to_vec())?;

    b.join("paper", a.addr()).await?;
    assert!(eventually(|| pa.len() == 2 && pb.len() == 2).await, "caught up both ways");

    // Live: a change on either side reaches the other.
    a.write("paper", b"a live change".to_vec())?;
    b.write("paper", b"a reply".to_vec())?;
    assert!(eventually(|| pa.len() == 4 && pb.len() == 4).await, "live both ways");
    assert_eq!(pa.vector(), pb.vector());
    Ok(())
}

#[tokio::test]
async fn changes_pass_through_a_copy_in_the_middle() -> anyhow::Result<()> {
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?, tempfile::tempdir()?);
    let (a, hub, c) = (node().await?, node().await?, node().await?);
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    let ph = hub.open("paper", b"secret", dirs.1.path())?;
    let pc = c.open("paper", b"secret", dirs.2.path())?;
    // A and C never connect to each other, only to the hub.
    a.join("paper", hub.addr()).await?;
    c.join("paper", hub.addr()).await?;
    a.write("paper", b"from A".to_vec())?;
    c.write("paper", b"from C".to_vec())?;
    assert!(eventually(|| pa.len() == 2 && ph.len() == 2 && pc.len() == 2).await);
    Ok(())
}

#[tokio::test]
async fn the_log_is_kept_across_restarts() -> anyhow::Result<()> {
    let dir = tempfile::tempdir()?;
    {
        let a = node().await?;
        a.open("paper", b"secret", dir.path())?;
        a.write("paper", b"one".to_vec())?;
        a.write("paper", b"two".to_vec())?;
        a.close().await;
    }
    let again = node().await?;
    let p = again.open("paper", b"secret", dir.path())?;
    assert_eq!(p.len(), 2);
    Ok(())
}

#[tokio::test]
async fn a_copy_without_the_key_gets_nothing() -> anyhow::Result<()> {
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?);
    let (a, b) = (node().await?, node().await?);
    a.open("paper", b"secret", dirs.0.path())?;
    a.write("paper", b"private".to_vec())?;
    let pb = b.open("paper", b"wrong", dirs.1.path())?;
    b.join("paper", a.addr()).await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(pb.is_empty(), "nothing received");
    Ok(())
}

#[tokio::test]
async fn a_newcomer_learns_every_member_from_one() -> anyhow::Result<()> {
    use iroh::address_lookup::memory::MemoryLookup;
    let book = MemoryLookup::new();
    let start = || {
        Node::start_with(
            SecretKey::generate(),
            Minimal,
            Some(book.clone()),
            Duration::from_millis(100),
        )
    };
    let (a, b, c) = (start().await?, start().await?, start().await?);
    for n in [&a, &b, &c] {
        book.add_endpoint_info(n.addr());
    }
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?, tempfile::tempdir()?);
    a.open("paper", b"secret", dirs.0.path())?;
    let pb = b.open("paper", b"secret", dirs.1.path())?;
    let pc = c.open("paper", b"secret", dirs.2.path())?;
    // B knows A; C is given only A, then finds B through it.
    b.join("paper", a.addr()).await?;
    assert!(eventually(|| b.is_syncing_with("paper", a.id())).await);
    c.join("paper", a.addr()).await?;
    assert!(
        eventually(|| c.is_syncing_with("paper", b.id()) || b.is_syncing_with("paper", c.id())).await,
        "C reached B, though only told of A"
    );
    // So with A gone, B's changes still reach C.
    a.close().await;
    b.write("paper", b"after A left".to_vec())?;
    assert!(eventually(|| pc.len() == pb.len() && pc.len() == 1).await);
    // And it's remembered for next time.
    assert!(std::fs::read_to_string(dirs.2.path().join("peers.json"))?.contains(b.id()));
    Ok(())
}

#[tokio::test]
async fn each_copy_knows_what_members_it_never_meets_have() -> anyhow::Result<()> {
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?, tempfile::tempdir()?);
    let a_key = iroh::SecretKey::generate();
    let (a, hub, c) = (Node::start(a_key.clone(), Minimal).await?, node().await?, node().await?);
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    hub.open("paper", b"secret", dirs.1.path())?;
    let pc = c.open("paper", b"secret", dirs.2.path())?;
    // A writes, and the hub acknowledges it.
    a.join("paper", hub.addr()).await?;
    a.write("paper", b"for everyone".to_vec())?;
    assert!(eventually(|| pa.members().contains_key(hub.id()) && pa.waiting_for(hub.id()) == 0).await);
    a.close().await;
    // C, which never meets A, gets it from the hub and acknowledges it.
    c.join("paper", hub.addr()).await?;
    assert!(eventually(|| pc.len() == 1).await);
    // A, back later, hears from the hub that C has its change.
    let a = Node::start(a_key, Minimal).await?;
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    assert_eq!(pa.waiting_for(c.id()), 1, "before: not known to have it");
    a.join("paper", hub.addr()).await?;
    assert!(eventually(|| pa.members().contains_key(c.id()) && pa.waiting_for(c.id()) == 0).await);
    // And kept for next time.
    assert!(std::fs::read_to_string(dirs.0.path().join("members.json"))?.contains(c.id()));
    Ok(())
}

#[tokio::test]
async fn old_history_goes_once_everyone_has_it_and_newcomers_start_from_a_snapshot() -> anyhow::Result<()> {
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?, tempfile::tempdir()?);
    let (a_key, hub_key) = (iroh::SecretKey::generate(), iroh::SecretKey::generate());
    let a = Node::start(a_key.clone(), Minimal).await?;
    let hub = Node::start(hub_key.clone(), Minimal).await?;
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    let ph = hub.open("paper", b"secret", dirs.1.path())?;
    for i in 0..3u8 {
        a.write("paper", vec![i])?;
    }
    a.join("paper", hub.addr()).await?;
    assert!(eventually(|| ph.len() == 3 && pa.waiting_for(hub.id()) == 0).await);
    // The hub goes offline, with 3; A goes on, and makes a snapshot of 5.
    hub.close().await;
    drop(ph);
    for i in 3..5u8 {
        a.write("paper", vec![i])?;
    }
    a.snapshot("paper", b"the whole document".to_vec())?;
    a.write("paper", b"after it".to_vec())?;
    assert_eq!(pa.prune(3600)?, 0, "the hub, known to lack two of them: all kept");
    // The hub back: it catches up, and then the five can go.
    let hub = Node::start(hub_key, Minimal).await?;
    let ph = hub.open("paper", b"secret", dirs.1.path())?;
    a.join("paper", hub.addr()).await?;
    assert!(eventually(|| ph.vector() == pa.vector() && pa.waiting_for(hub.id()) == 0).await);
    assert!(ph.snapshot().is_some());
    assert_eq!(pa.prune(3600)?, 5);
    assert_eq!(pa.len(), 1);
    // A newcomer, joining A: the snapshot and the one entry after it.
    let c = node().await?;
    let pc = c.open("paper", b"secret", dirs.2.path())?;
    c.join("paper", a.addr()).await?;
    assert!(eventually(|| pc.vector() == pa.vector()).await);
    assert_eq!(pc.len(), 1);
    assert_eq!(pc.snapshot().map(|s| s.data), Some(b"the whole document".to_vec()));
    // And A, restarted, has just what it kept.
    a.close().await;
    let a = Node::start(a_key, Minimal).await?;
    let pa2 = a.open("paper", b"secret", dirs.0.path())?;
    assert_eq!((pa2.len(), pa2.vector()), (1, pc.vector()));
    assert_eq!(a.write("paper", b"next".to_vec())?.n, 7);
    Ok(())
}
