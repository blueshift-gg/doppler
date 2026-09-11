//! The listings assemble to the checked-in programs. `UPDATE_TEMPLATES=1` rewrites them. Needs
//! `sbpf` on the path: `cargo install sbpf --version 0.3.0 --locked`.

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

#[test]
fn listings_assemble_to_the_programs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    for (listing, program) in [
        ("doppler.s", "doppler.so"),
        ("doppler-memcpy.s", "doppler-memcpy.so"),
    ] {
        let assembled = assemble(&root.join(listing));
        if std::env::var_os("UPDATE_TEMPLATES").is_some() {
            fs::write(root.join(program), &assembled).unwrap();
        }
        assert_eq!(
            fs::read(root.join(program)).unwrap(),
            assembled,
            "{listing}: run UPDATE_TEMPLATES=1 cargo test -p doppler --test templates"
        );
    }
}
