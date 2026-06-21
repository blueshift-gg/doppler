use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let integration_dir = manifest_dir
        .parent()
        .expect("sdk-harness crate should live under tests/integration");
    let cli_dir = integration_dir
        .parent()
        .and_then(|tests| tests.parent())
        .expect("cli package directory");
    let core_dir = cli_dir.parent().expect("packages directory").join("core");
    let schema = integration_dir.join("fixtures/schema.json");
    let custom_schema = integration_dir.join("fixtures/custom_payload_schema.json");
    let sol_memcpy_schema = integration_dir.join("fixtures/sol_memcpy_payload_schema.json");
    let script = integration_dir.join("scripts/generate-artifacts.mts");

    println!("cargo:rerun-if-changed={}", schema.display());
    println!("cargo:rerun-if-changed={}", custom_schema.display());
    println!("cargo:rerun-if-changed={}", sol_memcpy_schema.display());
    println!("cargo:rerun-if-changed={}", script.display());
    rerun_if_changed(&cli_dir.join("src"));
    rerun_if_changed(&core_dir.join("src"));
    rerun_if_changed(&core_dir.join("templates/rust"));

    generate_artifacts(&script, &cli_dir, &out_dir, &schema);
    copy_generated_sdk(&out_dir, &out_dir.join("rust-sdk/src"), "");

    let custom_out_dir = out_dir.join("custom");
    generate_artifacts(&script, &cli_dir, &custom_out_dir, &custom_schema);
    copy_generated_sdk(&out_dir, &custom_out_dir.join("rust-sdk/src"), "custom_");

    let sol_memcpy_out_dir = out_dir.join("sol_memcpy");
    generate_artifacts(&script, &cli_dir, &sol_memcpy_out_dir, &sol_memcpy_schema);
    copy_generated_sdk(
        &out_dir,
        &sol_memcpy_out_dir.join("rust-sdk/src"),
        "sol_memcpy_",
    );
}

fn copy_generated_sdk(out_dir: &Path, rust_sdk_src: &Path, prefix: &str) {
    for file in ["accounts.rs", "constants.rs", "transaction.rs"] {
        fs::copy(
            rust_sdk_src.join(file),
            out_dir.join(format!("{prefix}{file}")),
        )
        .unwrap_or_else(|error| panic!("failed to copy generated {prefix}{file}: {error}"));
    }

    let lib_rs =
        fs::read_to_string(rust_sdk_src.join("lib.rs")).expect("failed to read generated lib.rs");
    let lib_body = strip_generated_module_declarations(&lib_rs);
    fs::write(out_dir.join(format!("{prefix}lib_body.rs")), lib_body)
        .expect("failed to write generated lib body");
}

fn generate_artifacts(script: &Path, cli_dir: &Path, out_dir: &Path, schema: &Path) {
    let status = Command::new("bun")
        .arg("run")
        .arg(script)
        .arg(out_dir)
        .arg(schema)
        .current_dir(cli_dir)
        .status()
        .expect("failed to spawn bun; install Bun to run CLI integration tests");

    if !status.success() {
        panic!("doppler CLI artifact generation failed");
    }
}

fn rerun_if_changed(dir: &Path) {
    let entries = fs::read_dir(dir).unwrap_or_else(|error| {
        panic!("failed to read {}: {error}", dir.display());
    });

    for entry in entries {
        let entry = entry.expect("failed to read directory entry");
        let path = entry.path();
        println!("cargo:rerun-if-changed={}", path.display());
    }
}

fn strip_generated_module_declarations(source: &str) -> String {
    source
        .lines()
        .filter(|line| {
            !matches!(
                line.trim(),
                "mod accounts;"
                    | "mod constants;"
                    | "pub mod transaction;"
                    | "pub use accounts::{Oracle, UpdateInstruction};"
                    | "pub use accounts::{Oracle, OraclePayload, UpdateInstruction};"
                    | "pub use constants::ID;"
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}
