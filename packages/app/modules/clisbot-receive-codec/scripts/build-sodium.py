"""Build the pinned, authenticated upstream source with the app's Android NDK; one job."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile

VERSION = "1.0.22"
SHA256 = "adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349"
URL = f"https://download.libsodium.org/libsodium/releases/libsodium-{VERSION}.tar.gz"
TARGETS = {
    "arm64-v8a": "aarch64-linux-android",
    "armeabi-v7a": "armv7a-linux-androideabi",
    "x86": "i686-linux-android",
    "x86_64": "x86_64-linux-android",
}

parser = argparse.ArgumentParser()
parser.add_argument("--ndk", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--abis", required=True)
args = parser.parse_args()
root = Path(args.output).resolve()
root.mkdir(parents=True, exist_ok=True)
archive = root / f"libsodium-{VERSION}.tar.gz"
if not archive.exists():
    download = archive.with_suffix(".download")
    subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                    "--connect-timeout", "20", "--max-time", "90", "--output", str(download), URL], check=True)
    if hashlib.sha256(download.read_bytes()).hexdigest() != SHA256:
        raise SystemExit("Downloaded libsodium source integrity check failed")
    download.replace(archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
    raise SystemExit("Pinned libsodium source integrity check failed")
ndk = Path(args.ndk).resolve()
toolchain = ndk / "toolchains/llvm/prebuilt" / ("darwin-x86_64" if platform.system() == "Darwin" else "linux-x86_64")
for abi in args.abis.split(","):
    target = TARGETS[abi]
    prefix = root / abi
    stamp = {"sha256": SHA256, "ndk": (ndk / "source.properties").read_text(), "abi": abi, "api": 24}
    stamp_file = prefix / "binding.json"
    if stamp_file.exists() and json.loads(stamp_file.read_text()) == stamp and (prefix / "lib/libsodium.a").is_file():
        continue
    source_parent = root / f"source-{abi}"
    source_parent.mkdir(exist_ok=True)
    with tarfile.open(archive) as tar:
        tar.extractall(source_parent, filter="data")
    source = source_parent / f"libsodium-{VERSION}"
    env = dict(os.environ)
    env.update(CC=str(toolchain / "bin" / f"{target}24-clang"),
               AR=str(toolchain / "bin/llvm-ar"), RANLIB=str(toolchain / "bin/llvm-ranlib"),
               NM=str(toolchain / "bin/llvm-nm"), STRIP=str(toolchain / "bin/llvm-strip"),
               CFLAGS="-Os -fPIC", LDFLAGS="-Wl,-z,max-page-size=16384")
    # Same upstream Autotools Android target/minimal path, with bounded jobs and
    # static PIC linkage. Never patch cryptographic sources or enable LTO.
    subprocess.run([str(source / "configure"), f"--host={target}", f"--prefix={prefix}",
                    "--enable-minimal", "--disable-shared", "--enable-static", "--with-pic",
                    "--disable-pie", f"--with-sysroot={toolchain / 'sysroot'}"], cwd=source, env=env, check=True)
    subprocess.run(["make", "-j1", "install"], cwd=source, env=env, check=True)
    stamp_file.write_text(json.dumps(stamp, indent=2) + "\n")
