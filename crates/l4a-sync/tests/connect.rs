use iroh::{endpoint::presets::Minimal, Endpoint};
use l4a_sync::log::{Log, RELAY};
use l4a_sync::session::{answer, dial, Project};
use l4a_sync::ALPN;

async fn pair() -> anyhow::Result<(Endpoint, Endpoint)> {
    let a = Endpoint::builder(Minimal).alpns(vec![ALPN.to_vec()]).bind().await?;
    let b = Endpoint::builder(Minimal).alpns(vec![ALPN.to_vec()]).bind().await?;
    Ok((a, b))
}

#[tokio::test]
async fn two_copies_end_up_with_the_same_log() -> anyhow::Result<()> {
    let (a, b) = pair().await?;
    let (ida, idb) = (a.id().to_string(), b.id().to_string());

    let mut log_a = Log::new();
    log_a.append(RELAY, b"from the old relay".to_vec());
    log_a.append(&ida, b"alice's change".to_vec());
    let mut log_b = Log::new();
    log_b.append(RELAY, b"from the old relay".to_vec());
    log_b.append(&idb, b"bob's change".to_vec());
    log_b.append(&idb, b"bob's second".to_vec());

    let addr = a.addr();
    let (ida2, idb2) = (ida.clone(), idb.clone());
    let server = tokio::spawn(async move {
        let conn = a.accept().await.expect("incoming").await?;
        let got = answer(&conn, &ida2, &idb2, |id| {
            (id == "paper").then_some(Project { id: "paper", token: b"secret", log: &mut log_a })
        })
        .await?;
        conn.closed().await;
        anyhow::Ok((got, log_a))
    });
    let conn = b.connect(addr, ALPN).await?;
    let got_b = dial(&conn, &idb, &ida, Project { id: "paper", token: b"secret", log: &mut log_b }).await?;
    conn.close(0u32.into(), b"done");
    let (got_a, log_a) = server.await??;

    assert_eq!(got_a, 2, "alice got bob's two changes");
    assert_eq!(got_b, 1, "bob got alice's one; the relay's isn't sent twice");
    assert_eq!(log_a.vector(), log_b.vector());
    assert_eq!(log_a.len(), 4);
    Ok(())
}

#[tokio::test]
async fn a_copy_without_the_key_gets_nothing() -> anyhow::Result<()> {
    let (a, b) = pair().await?;
    let (ida, idb) = (a.id().to_string(), b.id().to_string());
    let mut log_a = Log::new();
    log_a.append(&ida, b"private".to_vec());
    let addr = a.addr();
    let (ida2, idb2) = (ida.clone(), idb.clone());
    let server = tokio::spawn(async move {
        let conn = a.accept().await.expect("incoming").await?;
        let r = answer(&conn, &ida2, &idb2, |_| {
            Some(Project { id: "paper", token: b"secret", log: &mut log_a })
        })
        .await;
        anyhow::Ok(r.is_err())
    });
    let conn = b.connect(addr, ALPN).await?;
    let mut log_b = Log::new();
    let r = dial(&conn, &idb, &ida, Project { id: "paper", token: b"wrong", log: &mut log_b }).await;
    assert!(r.is_err(), "refused");
    assert!(log_b.is_empty(), "nothing received");
    conn.close(0u32.into(), b"done");
    let _ = server.await;
    Ok(())
}
