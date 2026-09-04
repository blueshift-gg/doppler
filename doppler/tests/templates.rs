//! The listings assemble to the checked-in programs. `UPDATE_TEMPLATES=1` rewrites them. The push
//! programs need `sbpf` on the path: `cargo install sbpf --version 0.3.0 --locked`. The pull programs
//! need `CARGO_BUILD_SBF` pointing at a cargo-build-sbf with platform-tools v1.53 or newer, and are
//! skipped without it.

use std::{fs, path::Path, process::Command};

fn assemble(listing: &Path) -> Vec<u8> {
    let dir = std::env::temp_dir().join(format!("doppler-asm-{}", std::process::id()));
    fs::create_dir_all(dir.join("src/t")).unwrap();
    let source: String = fs::read_to_string(listing)
        .unwrap()
        .lines()
        .map(|line| line.split(';').next().unwrap().trim_end())
        .filter(|line| !line.is_empty())
        .fold(String::new(), |s, line| s + line + "\n");
    fs::write(dir.join("src/t/t.s"), source).unwrap();
    let output = Command::new("sbpf")
        .arg("build")
        .current_dir(&dir)
        .output()
        .expect("sbpf on the path: cargo install sbpf --version 0.3.0 --locked");
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let so = fs::read(dir.join("deploy/t.so")).unwrap();
    fs::remove_dir_all(&dir).unwrap();
    so
}

/// Builds program-extended and drops the section headers: the loader wants the program headers only,
/// and `generate_pull` then has one length to patch.
fn build_pull(root: &Path, cargo_build_sbf: &str, memcpy: bool) -> Vec<u8> {
    let mut command = Command::new(cargo_build_sbf);
    command
        .args(["--arch", "v3", "--manifest-path"])
        .arg(root.join("../program-extended/Cargo.toml"));
    if memcpy {
        command.args(["--features", "memcpy"]);
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut so = fs::read(root.join("../target/deploy/doppler_extended_program.so")).unwrap();
    let u64_at =
        |elf: &[u8], at: usize| u64::from_le_bytes(elf[at..at + 8].try_into().unwrap()) as usize;
    let (phoff, phnum) = (
        u64_at(&so, 0x20),
        u16::from_le_bytes([so[0x38], so[0x39]]) as usize,
    );
    let end = (0..phnum)
        .map(|i| u64_at(&so, phoff + 56 * i + 0x08) + u64_at(&so, phoff + 56 * i + 0x20))
        .max()
        .unwrap();
    so.truncate(end);
    so[0x28..0x30].fill(0);
    so[0x3c..0x40].fill(0);
    so
}

#[test]
fn listings_assemble_to_the_programs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let update = std::env::var_os("UPDATE_TEMPLATES").is_some();
    let check = |program: &str, bytes: Vec<u8>| {
        let path = root.join(program);
        if update {
            fs::write(&path, &bytes).unwrap();
        }
        assert_eq!(
            fs::read(&path).unwrap(),
            bytes,
            "{program}: run UPDATE_TEMPLATES=1 cargo test -p doppler --test templates"
        );
    };
    check("doppler.so", assemble(&root.join("doppler.s")));
    check(
        "doppler-memcpy.so",
        assemble(&root.join("doppler-memcpy.s")),
    );
    match std::env::var("CARGO_BUILD_SBF") {
        Ok(tool) => {
            check("doppler-pull.so", build_pull(root, &tool, false));
            check("doppler-pull-memcpy.so", build_pull(root, &tool, true));
        }
        Err(_) => eprintln!("CARGO_BUILD_SBF unset: the pull programs are not rebuilt"),
    }
}
