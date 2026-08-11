mod commands;

use clap::{CommandFactory, Parser};
use commands::{deploy, generate, init};

#[derive(Parser)]
#[command(
    name = "doppler",
    about = "Generate and deploy custom Doppler binaries from a payload schema"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(clap::Subcommand)]
enum Command {
    Init(init::InitArgs),
    Generate(generate::GenerateArgs),
    Deploy(deploy::DeployArgs),
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), anyhow::Error> {
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Init(args)) => init::run(args),
        Some(Command::Generate(args)) => generate::run(args),
        Some(Command::Deploy(args)) => deploy::run(args),
        None => {
            Cli::command().print_help()?;
            println!();
            Ok(())
        }
    }
}
