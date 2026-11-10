fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new().file("src/system_signals.m").flag("-fobjc-arc").flag("-fblocks").compile("fulcrum_system_signals");
        for framework in ["AppKit", "Foundation", "IOKit"] { println!("cargo:rustc-link-lib=framework={framework}"); }
    }
    println!("cargo:rerun-if-changed=src/system_signals.m");
    tauri_build::build();
}
