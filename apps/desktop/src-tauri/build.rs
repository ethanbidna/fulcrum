fn main() {
    println!("cargo:rerun-if-env-changed=FULCRUM_UPDATER_PUBLIC_KEY");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/system_signals.m").file("src/setup_native.m").file("src/workspace_keys.m").flag("-fobjc-arc").flag("-fblocks").compile("fulcrum_system_signals");
        for framework in ["AppKit", "Foundation", "IOKit", "Security", "LocalAuthentication"] { println!("cargo:rustc-link-lib=framework={framework}"); }
    }
    println!("cargo:rerun-if-changed=src/system_signals.m");
    println!("cargo:rerun-if-changed=src/setup_native.m");
    println!("cargo:rerun-if-changed=src/workspace_keys.m");
    tauri_build::build();
}
