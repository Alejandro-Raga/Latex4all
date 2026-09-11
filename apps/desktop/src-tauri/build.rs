fn main() {
    // Embed ZOTERO credentials at compile time from .env file or system env
    let _ = dotenvy::dotenv(); // load .env if present (local dev)
    for key in ["ZOTERO_CONSUMER_KEY", "ZOTERO_CONSUMER_SECRET"] {
        if let Ok(val) = std::env::var(key) {
            println!("cargo:rustc-env={key}={val}");
        }
    }

    // The commit this binary was built from. It lets the updater tell "same
    // code under a different version number" from a real update — test builds
    // are numbered by CI run, so the tip of `testing` and the release cut from
    // the very same commit carry different versions. Unset in local dev
    // builds, where the check is simply skipped.
    println!("cargo:rerun-if-env-changed=LATEX4ALL_COMMIT");
    if let Ok(val) = std::env::var("LATEX4ALL_COMMIT") {
        println!("cargo:rustc-env=LATEX4ALL_COMMIT={val}");
    }

    // On Linux, apply a version script to hide statically linked ICU/HarfBuzz/
    // FreeType/Fontconfig symbols from the dynamic symbol table.  This prevents
    // symbol collisions with the system copies loaded by WebKit2GTK (segfault).
    // See: https://github.com/delibae/claude-prism/issues/100
    #[cfg(target_os = "linux")]
    {
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
        println!(
            "cargo:rustc-link-arg=-Wl,--version-script={}/symbols.map",
            manifest_dir
        );
        println!("cargo:rerun-if-changed=symbols.map");
    }

    tauri_build::build()
}
