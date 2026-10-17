/**
 * Distro registry for the Acode terminal sandbox.
 *
 * Each entry describes one installable Linux distribution. The terminal
 * plugin is now distro-agnostic: pick a distro, download its rootfs,
 * extract it to $PREFIX/distros/<id>/, and launch it through proot with
 * the matching init script.
 *
 * Package managers are exposed so plugins (e.g. acode-opencode) can install
 * tooling on any distro without hardcoding Alpine/apk.
 *
 * rootfs URLs: point these at whatever mirror you trust. Debian/Arch/etc do
 * not publish official per-arch minirootfs tarballs at one stable URL, so the
 * templates below are community-mirror patterns. For F-Droid builds, bundle
 * tarballs under distro_assets/<arch>/<id>.rootfs instead.
 */

const DISTROS = {
  debian: {
    id: "debian",
    name: "Debian",
    icon: "terminal",
    packageManager: "apt",
    installCmd: "apt install <pkg>",
    updateCmd: "apt-get update && apt-get upgrade -y",
    searchCmd: "apt search <query>",
    removeCmd: "apt remove <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "arm64", file: "debian-rootfs-arm64.tar.gz" },
      "armeabi-v7a": { dir: "armhf", file: "debian-rootfs-armhf.tar.gz" },
      "x86_64": { dir: "amd64", file: "debian-rootfs-amd64.tar.gz" },
    },
    // Example mirror pattern — replace with a tarball you host:
    // urlTemplate: "https://example.com/mirrors/debian/{dir}/{file}"
  },

  ubuntu: {
    id: "ubuntu",
    name: "Ubuntu",
    icon: "terminal",
    packageManager: "apt",
    installCmd: "apt install <pkg>",
    updateCmd: "apt-get update && apt-get upgrade -y",
    searchCmd: "apt search <query>",
    removeCmd: "apt remove <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "arm64", file: "ubuntu-rootfs-arm64.tar.gz" },
      "armeabi-v7a": { dir: "armhf", file: "ubuntu-rootfs-armhf.tar.gz" },
      "x86_64": { dir: "amd64", file: "ubuntu-rootfs-amd64.tar.gz" },
    },
    initScript: "init-distro.sh",
  },

  arch: {
    id: "arch",
    name: "Arch Linux",
    icon: "terminal",
    packageManager: "pacman",
    installCmd: "pacman -S <pkg>",
    updateCmd: "pacman -Syu --noconfirm",
    searchCmd: "pacman -Ss <query>",
    removeCmd: "pacman -R <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "aarch64", file: "arch-rootfs-aarch64.tar.gz" },
      "armeabi-v7a": { dir: "armv7h", file: "arch-rootfs-armv7h.tar.gz" },
      "x86_64": { dir: "x86_64", file: "arch-rootfs-x86_64.tar.gz" },
    },
  },

  fedora: {
    id: "fedora",
    name: "Fedora",
    icon: "terminal",
    packageManager: "dnf",
    installCmd: "dnf install <pkg>",
    updateCmd: "dnf upgrade -y",
    searchCmd: "dnf search <query>",
    removeCmd: "dnf remove <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "aarch64", file: "fedora-rootfs-aarch64.tar.gz" },
      "armeabi-v7a": { dir: "armhfp", file: "fedora-rootfs-armhfp.tar.gz" },
      "x86_64": { dir: "x86_64", file: "fedora-rootfs-x86_64.tar.gz" },
    },
  },

  void: {
    id: "void",
    name: "Void Linux",
    icon: "terminal",
    packageManager: "xbps",
    installCmd: "xbps-install -S <pkg>",
    updateCmd: "xbps-install -Su -y",
    searchCmd: "xbps-query -Rs <query>",
    removeCmd: "xbps-remove <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "aarch64", file: "void-rootfs-aarch64.tar.gz" },
      "armeabi-v7a": { dir: "armv7l", file: "void-rootfs-armv7l.tar.gz" },
      "x86_64": { dir: "x86_64", file: "void-rootfs-x86_64.tar.gz" },
    },
  },

  opensuse: {
    id: "opensuse",
    name: "openSUSE Tumbleweed",
    icon: "terminal",
    packageManager: "zypper",
    installCmd: "zypper install <pkg>",
    updateCmd: "zypper refresh && zypper update -y",
    searchCmd: "zypper search <query>",
    removeCmd: "zypper remove <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "aarch64", file: "opensuse-rootfs-aarch64.tar.gz" },
      "armeabi-v7a": { dir: "armv7l", file: "opensuse-rootfs-armv7l.tar.gz" },
      "x86_64": { dir: "x86_64", file: "opensuse-rootfs-x86_64.tar.gz" },
    },
  },

  manjaro: {
    id: "manjaro",
    name: "Manjaro",
    icon: "terminal",
    packageManager: "pacman",
    installCmd: "pacman -S <pkg>",
    updateCmd: "pacman -Syu --noconfirm",
    searchCmd: "pacman -Ss <query>",
    removeCmd: "pacman -R <pkg>",
    defaultShell: "/bin/bash",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "aarch64", file: "manjaro-rootfs-aarch64.tar.gz" },
      "armeabi-v7a": { dir: "armv7", file: "manjaro-rootfs-armv7.tar.gz" },
      "x86_64": { dir: "x86_64", file: "manjaro-rootfs-x86_64.tar.gz" },
    },
  },

  kali: {
    id: "kali",
    name: "Kali Linux",
    icon: "terminal",
    packageManager: "apt",
    installCmd: "apt install <pkg>",
    updateCmd: "apt-get update && apt-get upgrade -y",
    searchCmd: "apt search <query>",
    removeCmd: "apt remove <pkg>",
    defaultShell: "/bin/zsh",
    initScript: "init-distro.sh",
    arch: {
      "arm64-v8a": { dir: "arm64", file: "kali-rootfs-arm64.tar.gz" },
      "armeabi-v7a": { dir: "armhf", file: "kali-rootfs-armhf.tar.gz" },
      "x86_64": { dir: "amd64", file: "kali-rootfs-amd64.tar.gz" },
    },
  },
};

/** All distro ids in display order. */
export const DISTRO_IDS = Object.keys(DISTROS);

/** Default distro installed when the user makes no choice. */
export const DEFAULT_DISTRO = "debian";

/**
 * Look up a distro by id. Falls back to debian for unknown ids.
 * @param {string} id
 * @returns {import("./distros.js").Distro}
 */
export function getDistro(id) {
  return DISTROS[id] || DISTROS[DEFAULT_DISTRO];
}

/**
 * Get package-manager info for a distro so external plugins (acode-opencode,
 * distro-manager, lsp runtimes, etc.) can install tooling without assuming
 * Alpine/apk.
 * @param {string} id
 * @returns {{id, name, packageManager, installCmd, updateCmd, searchCmd, removeCmd, defaultShell}}
 */
export function getDistroInfo(id) {
  const d = getDistro(id);
  return {
    id: d.id,
    name: d.name,
    packageManager: d.packageManager,
    installCmd: d.installCmd,
    updateCmd: d.updateCmd,
    searchCmd: d.searchCmd,
    removeCmd: d.removeCmd,
    defaultShell: d.defaultShell,
  };
}

export default DISTROS;
