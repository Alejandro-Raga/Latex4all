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
