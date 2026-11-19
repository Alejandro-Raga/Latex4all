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

#[tokio::test]
async fn a_hub_keeps_every_file_and_hands_it_on_later() -> anyhow::Result<()> {
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?, tempfile::tempdir()?);
    let (a, hub, c) = (node().await?, node().await?, node().await?);
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    let ph = hub.open("paper", b"secret", dirs.1.path())?;
    ph.keep_all_blobs(true);
    let pc = c.open("paper", b"secret", dirs.2.path())?;
    // A file over three pieces long.
    let figure: Vec<u8> = (0..3_500_000u32).map(|i| (i % 251) as u8).collect();
    let name = pa.put_blob(&figure)?;
    a.write("paper", name.as_bytes().to_vec())?;
    a.join("paper", hub.addr()).await?;
    assert!(eventually(|| ph.blob(&name).is_some()).await, "the hub fetched it by itself");
    a.close().await;
    // C, never online with A, asks for it when it needs it.
    c.join("paper", hub.addr()).await?;
    assert!(eventually(|| pc.len() == 1).await);
    assert!(pc.blob(&name).is_none(), "not fetched until wanted");
    let mut news = pc.subscribe();
    pc.want_blob(&name);
    assert!(eventually(|| pc.blob(&name).is_some()).await);
    assert_eq!(pc.blob(&name).unwrap(), figure);
    assert!(matches!(news.try_recv(), Ok((l4a_sync::Change::Blob(n), _)) if n == name));
    Ok(())
}

#[tokio::test]
async fn the_creator_removes_a_member_who_then_gets_nothing() -> anyhow::Result<()> {
    use iroh::address_lookup::memory::MemoryLookup;
    use l4a_sync::{Change, Rekeying};
    let book = MemoryLookup::new();
    let start = || Node::start_with(iroh::SecretKey::generate(), Minimal, Some(book.clone()), Duration::from_millis(100));
    let (a, b, m, hub) = (start().await?, start().await?, start().await?, start().await?);
    let dirs: Vec<_> = (0..4).map(|_| tempfile::tempdir().unwrap()).collect();
    let mut projects = Vec::new();
    for (node, dir) in [&a, &b, &m, &hub].into_iter().zip(&dirs) {
        book.add_endpoint_info(node.addr());
        let p = node.open("paper", b"secret", dir.path())?;
        p.set_creator(a.id())?;
        projects.push(p);
    }
    let (pa, pb, pm, ph) = (&projects[0], &projects[1], &projects[2], &projects[3]);
    for node in [&a, &b, &m] {
        node.join("paper", hub.addr()).await?;
    }
    a.write("paper", b"before".to_vec())?;
    assert!(eventually(|| projects.iter().all(|p| p.len() == 1)).await);

    // Only the creator can remove anyone.
    let plan = |token: &[u8]| Rekeying {
        remove: vec![m.id().to_string()],
        creator: None,
        token: token.to_vec(),
        key: b"new key".to_vec(),
        token_only: vec![hub.id().to_string()],
    };
    assert!(b.rekey("paper", plan(b"b's token")).is_err());
    let mut b_news = pb.subscribe();
    let mut hub_news = ph.subscribe();
    let mut m_news = pm.subscribe();
    a.rekey("paper", plan(b"new token"))?;
    let ok = eventually(|| pb.epoch() == 1 && ph.epoch() == 1 && pm.removed()).await;
    assert!(ok, "a {} b {} hub {} m {} removed {}", pa.epoch(), pb.epoch(), ph.epoch(), pm.epoch(), pm.removed());
    let rekey_of = |news: &mut tokio::sync::broadcast::Receiver<(Change, Option<String>)>| loop {
        match news.try_recv() {
            Ok((Change::Rekey { key, .. }, _)) => break Some(key),
            Ok(_) => continue,
            Err(_) => break None,
        }
    };
    assert_eq!(rekey_of(&mut b_news), Some(Some(b"new key".to_vec())), "B gets the new key");
    assert_eq!(rekey_of(&mut hub_news), Some(None), "the hub gets no key");
    assert!(std::iter::from_fn(|| m_news.try_recv().ok()).any(|(c, _)| matches!(c, Change::Removed)));
    assert_eq!(pm.epoch(), 0);

    // The others go on syncing as of the new epoch; M's changes reach no one.
    let _ = m.write("paper", b"from M, after".to_vec());
    b.write("paper", b"from B, after".to_vec())?;
    assert!(eventually(|| pa.len() == 2 && ph.len() == 2).await);
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!((pa.len(), pb.len(), ph.len()), (2, 2, 2));
    assert!(!pm.entries().iter().any(|e| e.data == b"from B, after"));
    Ok(())
}

#[tokio::test]
async fn a_member_the_creator_missed_is_left_out_not_removed_and_included_again() -> anyhow::Result<()> {
    use iroh::address_lookup::memory::MemoryLookup;
    use l4a_sync::{Change, Rekeying};
    let book = MemoryLookup::new();
    let start = || Node::start_with(iroh::SecretKey::generate(), Minimal, Some(book.clone()), Duration::from_millis(100));
    let (a, b, hub) = (start().await?, start().await?, start().await?);
    let dirs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
    for n in [&a, &b, &hub] {
        book.add_endpoint_info(n.addr());
    }
    let pa = a.open("paper", b"secret", dirs[0].path())?;
    let ph = hub.open("paper", b"secret", dirs[2].path())?;
    pa.set_creator(a.id())?;
    ph.set_creator(a.id())?;
    a.join("paper", hub.addr()).await?;
    assert!(eventually(|| pa.known_peers().contains(&hub.id().to_string())).await);
    // A rekeys knowing only the hub; B, with the old link, comes after.
    let plan = || Rekeying {
        remove: vec![],
        creator: None,
        token: b"token 1".to_vec(),
        key: b"key 1".to_vec(),
        token_only: vec![hub.id().to_string()],
    };
    a.rekey("paper", plan())?;
    assert!(eventually(|| ph.epoch() == 1).await);
    let mut a_news = pa.subscribe();
    let pb = b.open("paper", b"secret", dirs[1].path())?;
    pb.set_creator(a.id())?;
    let mut b_news = pb.subscribe();
    b.join("paper", hub.addr()).await?;
    let left_out = |news: &mut tokio::sync::broadcast::Receiver<(Change, Option<String>)>, who: &str| {
        std::iter::from_fn(|| news.try_recv().ok()).any(|(c, _)| matches!(c, Change::LeftOut(ref m) if m == who))
    };
    assert!(eventually(|| pa.known_peers().contains(&b.id().to_string())).await);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(!pb.removed(), "missed, not removed");
    assert!(left_out(&mut b_news, b.id()));
    assert!(left_out(&mut a_news, b.id()), "the creator hears of it");
    // The creator includes B: the same token and key, a new record.
    a.rekey("paper", plan())?;
    assert!(eventually(|| pb.epoch() == 2).await);
    a.write("paper", b"for B too".to_vec())?;
    assert!(eventually(|| pb.len() == 1).await);
    Ok(())
}

#[tokio::test]
async fn a_shared_folder_carries_changes_between_copies_never_online_together() -> anyhow::Result<()> {
    let cloud = tempfile::tempdir()?;
    let shared = cloud.path().join("Dropbox/Thesis sync");
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?);
    let (ka, kb) = (iroh::SecretKey::generate(), iroh::SecretKey::generate());
    // A, alone: writes, a file too, and syncs through the folder.
    let a = Node::start(ka.clone(), Minimal).await?;
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    a.write("paper", b"from A".to_vec())?;
    let figure = pa.put_blob(b"a figure")?;
    l4a_sync::folder::sync(&pa, &shared, &dirs.0.path().join("folder.json"))?;
    a.close().await;
    // B, later, finds the folder by its marker and gets everything.
    let found = l4a_sync::folder::find(&[cloud.path().to_path_buf()], "paper").unwrap();
    assert_eq!(found, shared);
    let b = Node::start(kb, Minimal).await?;
    let pb = b.open("paper", b"secret", dirs.1.path())?;
    pb.want_blob(&figure);
    l4a_sync::folder::sync(&pb, &found, &dirs.1.path().join("folder.json"))?;
    assert_eq!(pb.len(), 1);
    assert_eq!(pb.blob(&figure), Some(b"a figure".to_vec()));
    // A forged segment (another's entry, data changed) is refused.
    b.write("paper", b"from B".to_vec())?;
    l4a_sync::folder::sync(&pb, &found, &dirs.1.path().join("folder.json"))?;
    // A back: gets B's change, and learns B has A's.
    let a = Node::start(ka, Minimal).await?;
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    l4a_sync::folder::sync(&pa, &shared, &dirs.0.path().join("folder.json"))?;
    assert_eq!(pa.len(), 2);
    assert_eq!(pa.waiting_for(b.id()), 0);
    // Someone tidies the folder: A's files go; A writes them again.
    std::fs::remove_dir_all(shared.join(a.id()))?;
    l4a_sync::folder::sync(&pa, &shared, &dirs.0.path().join("folder.json"))?;
    let fresh = tempfile::tempdir()?;
    let c = node().await?;
    let pc = c.open("paper", b"secret", fresh.path())?;
    l4a_sync::folder::sync(&pc, &shared, &fresh.path().join("folder.json"))?;
    assert_eq!(pc.len(), 2);
    // Half a file (still downloading) waits, and is read once whole.
    let seg = shared.join(b.id()).join("0000000009.seg");
    std::fs::write(&seg, [0, 0, 0, 9, 1, 2])?;
    l4a_sync::folder::sync(&pc, &shared, &fresh.path().join("folder.json"))?;
    assert_eq!(pc.len(), 2);
    Ok(())
}

#[tokio::test]
async fn an_app_sets_up_a_hub_with_its_code_and_it_keeps_the_project() -> anyhow::Result<()> {
    use iroh::address_lookup::memory::MemoryLookup;
    use l4a_sync::hub::Hub;
    let book = MemoryLookup::new();
    let start = |k: iroh::SecretKey| Node::start_with(k, Minimal, Some(book.clone()), Duration::from_millis(100));
    let data = tempfile::tempdir()?;
    let hub_key = iroh::SecretKey::generate();
    let hub = Hub::start(start(hub_key.clone()).await?, data.path())?;
    let (a, c) = (start(iroh::SecretKey::generate()).await?, start(iroh::SecretKey::generate()).await?);
    for n in [&*hub.node, &a, &c] {
        book.add_endpoint_info(n.addr());
    }
    let dirs = (tempfile::tempdir()?, tempfile::tempdir()?);
    let pa = a.open("paper", b"secret", dirs.0.path())?;
    a.write("paper", b"kept by the hub".to_vec())?;
    // A wrong code is refused; the right one works.
    let code = hub.code();
    let wrong = format!("{}.{}", hub.node.id(), "00".repeat(32));
    assert!(a.add_to_hub(&wrong, "paper", b"secret", Some(a.id())).await.is_err());
    a.add_to_hub(&code, "paper", b"secret", Some(a.id())).await?;
    assert_eq!(hub.projects(), vec!["paper".to_string()]);
    assert!(eventually(|| pa.waiting_for(hub.node.id()) == 0 && pa.members().contains_key(hub.node.id())).await);
    a.close().await;
    // The hub, restarted, still has it; C gets it from the hub alone.
    hub.node.close().await;
    drop(hub);
    let hub = Hub::start(start(hub_key).await?, data.path())?;
    book.add_endpoint_info(hub.node.addr());
    assert_eq!(hub.projects(), vec!["paper".to_string()]);
    let pc = c.open("paper", b"secret", dirs.1.path())?;
    c.join("paper", hub.node.addr()).await?;
    assert!(eventually(|| pc.len() == 1).await);
    Ok(())
}

#[tokio::test]
async fn a_public_hub_takes_members_only_and_brings_the_relay_history_over() -> anyhow::Result<()> {
    use iroh::address_lookup::memory::MemoryLookup;
    use l4a_sync::hub::{Hub, Options};
    use sha2::Digest;
    let book = MemoryLookup::new();
    let start = |k: iroh::SecretKey| Node::start_with(k, Minimal, Some(book.clone()), Duration::from_millis(100));
    // The relay's folder for one project: access hash, a snapshot, two
    // updates after it, one file.
    let relay = tempfile::tempdir()?;
    let id = "0123456789abcdef0123456789abcdef";
    let p = relay.path().join(id);
    std::fs::create_dir_all(p.join("blobs"))?;
    let hash: String = sha2::Sha256::digest(b"access-token").iter().map(|b| format!("{b:02x}")).collect();
    std::fs::write(p.join("meta.json"), format!(r#"{{"accessHash":"{hash}","created":1}}"#))?;
    let mut snap = 5u64.to_be_bytes().to_vec();
    snap.extend_from_slice(b"snapshot to 5");
    std::fs::write(p.join("snapshot.bin"), snap)?;
    let record = |seq: u64, data: &[u8]| {
        let mut r = seq.to_be_bytes().to_vec();
        r.extend_from_slice(&(data.len() as u32).to_be_bytes());
        r.extend_from_slice(data);
        r
    };
    let mut log = record(4, b"old, in the snapshot");
    log.extend(record(6, b"update 6"));
    log.extend(record(7, b"update 7"));
    std::fs::write(p.join("log.bin"), &log)?;
    std::fs::write(p.join("blobs").join("ab".repeat(32)), b"a sealed file")?;

    let data = tempfile::tempdir()?;
    let hub = Hub::start_with(
        start(iroh::SecretKey::generate()).await?,
        data.path(),
        Options { public: true, relay: Some(relay.path().to_path_buf()) },
    )?;
    let a = start(iroh::SecretKey::generate()).await?;
    for n in [&*hub.node, &a] {
        book.add_endpoint_info(n.addr());
    }
    let code = hub.code();
    assert!(code.ends_with(".public"));
    let dir = tempfile::tempdir()?;
    let pa = a.open(id, b"secret", dir.path())?;
    // Without the access token: refused.
    assert!(a.add_to_public_hub(&code, id, b"secret", b"guess", None).await.is_err());
    assert!(hub.projects().is_empty());
    a.add_to_public_hub(&code, id, b"secret", b"access-token", None).await?;
    assert_eq!(hub.projects(), vec![id.to_string()]);
    // The snapshot and the updates after it, in order, and the file.
    assert!(eventually(|| pa.len() == 3).await);
    let got: Vec<Vec<u8>> = pa.entries().into_iter().map(|e| e.data.clone()).collect();
    assert_eq!(got, vec![b"snapshot to 5".to_vec(), b"update 6".to_vec(), b"update 7".to_vec()]);
    let hp = hub.node.project(id).unwrap();
    assert!(hp.blob(&{
        let h = sha2::Sha256::digest(b"a sealed file");
        h.iter().map(|b| format!("{b:02x}")).collect::<String>()
    }).is_some());
    // An update reaching the relay later is brought over too, once.
    log.extend(record(8, b"update 8"));
    std::fs::write(p.join("log.bin"), &log)?;
    hub.import_all();
    hub.import_all();
    assert!(eventually(|| pa.len() == 4).await);
    Ok(())
}
