const Executor = require("./Executor");

/** Distro registry, inlined so Cordova never has to resolve a separate module. */
const DISTROS = {
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
    },
};

const DISTRO_IDS = Object.keys(DISTROS);
const DEFAULT_DISTRO = "ubuntu";

function getDistro(id) {
    return DISTROS[id] || DISTROS[DEFAULT_DISTRO];
}

function getDistroInfo(id) {
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

let activeDistro = DEFAULT_DISTRO;

const Terminal = {
    /**
     * Sets the distro that the terminal launches. Persists across the session.
     * @param {string} distro - Distro id (debian, arch, ubuntu, fedora, ...)
     */
    setActiveDistro(distro) {
        activeDistro = getDistro(distro).id;
    },

    /**
     * Returns the currently active distro id.
     * @returns {string}
     */
    getActiveDistro() {
        return activeDistro;
    },

    /**
     * Returns the full distro registry.
     * @returns {object}
     */
    getDistros() {
        return DISTROS;
    },

    /**
     * Returns package-manager info for a distro so external plugins
     * (acode-opencode, distro-manager, lsp runtimes, ...) can install
     * tooling without assuming Alpine/apk.
     * @param {string} [distro] - defaults to active distro
     * @returns {{id, name, packageManager, installCmd, updateCmd, searchCmd, removeCmd, defaultShell}}
     */
    getDistroInfo(distro) {
        return getDistroInfo(distro || activeDistro);
    },

    /**
     * Starts the AXS environment by writing init scripts and executing the sandbox.
     * @param {boolean} [installing=false] - Whether AXS is being started during installation.
     * @param {Function} [logger=console.log] - Function to log standard output.
     * @param {Function} [err_logger=console.error] - Function to log errors.
     * @param {boolean} [failsafe=false] - Start with system shell (fail-safe mode).
     * @param {string} [distro] - Distro id to launch (defaults to active distro).
     * @returns {Promise<boolean>} - Returns true if installation completes with exit code 0, void if not installing
     */
    async startAxs(installing = false, logger = console.log, err_logger = console.error, failsafe = false, distro) {
        const distroId = distro || activeDistro;
        const d = getDistro(distroId);
        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        const failsafeArg = failsafe ? "--failsafe" : "";
        const installingArg = installing ? "--installing" : "";

        const [initDistro, rmWrapper, initSandbox] = await Promise.all([
            readAsset("init-distro.sh"),
            readAsset("rm-wrapper.sh"),
            readAsset("init-sandbox.sh"),
        ]);

        await this.migrateLegacyHome();

        const isFdroid = await Executor.execute("echo $FDROID");

        if (isFdroid !== "true") {
            // the symlink must be updated everytime because the symlinks to native libs can break after app updates
            await Executor.execute("rm -f $PREFIX/axs && ln -s $NATIVE_DIR/libaxs.so $PREFIX/axs");
        }

        await writeText(`${filesDir}/init-distro.sh`, initDistro);
        await writeText(`${filesDir}/init-sandbox.sh`, initSandbox);

        const distroDir = `${filesDir}/distros/${distroId}`;
        await deleteFile(`${distroDir}/bin/rm`).catch(() => {});
        await writeText(`${distroDir}/bin/rm`, rmWrapper);
        await setExec(`${distroDir}/bin/rm`, true);

        // Pass the distro id as the first positional argument to the sandbox.
        const sandboxArgs = `${distroId} ${installingArg} ${failsafeArg}`.trim();

        if (installing) {
            return new Promise((resolve, reject) => {
                let lastError = "";

                Executor.start("sh", (type, data) => {
                    logger(`${type} ${data}`);

                    if (type === "stderr" && data) {
                        lastError = lastError ? `${lastError}\n${data}` : data;
                    }

                    // Check for exit code during installation
                    if (type === "exit") {
                        const success = data === "0";
                        if (!success) {
                            this.lastInstallError = lastError
                                ? `Sandbox configuration failed with exit code ${data}: ${lastError}`
                                : `Sandbox configuration failed with exit code ${data}`;
                        }
                        resolve(success);
                    }
                }).then(async (uuid) => {
                    await Executor.write(uuid, `source ${filesDir}/init-sandbox.sh ${sandboxArgs}; exit`);
                }).catch((error) => {
                    const message = `Failed to start AXS: ${formatError(error)}`;
                    this.lastInstallError = message;
                    err_logger(message);
                    resolve(false);
                });
            });
        } else {
            try {
                const uuid = await Executor.start("sh", (type, data) => {
                    logger(`${type} ${data}`);
                });
                await Executor.write(uuid, `source ${filesDir}/init-sandbox.sh ${sandboxArgs}; exit`);
            } catch (error) {
                const message = `Failed to start AXS: ${formatError(error)}`;
                err_logger(message);
                throw new Error(message);
            }
        }
    },

    /**
     * Stops the AXS process by forcefully killing it.
     * @returns {Promise<void>}
     */
    async stopAxs() {
        await Executor.execute(`kill -KILL $(cat $PREFIX/pid)`);
    },

    /**
     * Checks if the AXS process is currently running.
     * @returns {Promise<boolean>} - `true` if AXS is running, `false` otherwise.
     */
    async isAxsRunning() {
        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        const pidExists = await new Promise((resolve, reject) => {
            system.fileExists(`${filesDir}/pid`, false, (result) => {
                resolve(result == 1);
            }, reject);
        });

        if (!pidExists) return false;

        const result = await Executor.BackgroundExecutor.execute(`kill -0 $(cat $PREFIX/pid) 2>/dev/null && echo "true" || echo "false"`);
        return String(result).toLowerCase() === "true";
    },

    /**
     * Installs Debian by downloading binaries and extracting the root filesystem.
     * Also sets up additional dependencies for F-Droid variant.
     * @param {Function} [logger=console.log] - Function to log standard output.
     * @param {Function} [err_logger=console.error] - Function to log errors.
     * @returns {Promise<boolean>} - Returns true if installation completes with exit code 0
     */
    async install(distro = DEFAULT_DISTRO, logger = console.log, err_logger = console.error) {
        if (!(await this.isSupported())) return false;

        distro = getDistro(distro).id;
        activeDistro = distro;

        const isFdroid = await Executor.execute("echo $FDROID");

        this.lastInstallError = "";

        try {
            //cleanup before install
            await this.uninstall(distro);
        } catch (e) {
            //supress error
        }

        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        const arch = await new Promise((resolve, reject) => {
            system.getArch(resolve, reject);
        });

        try {

            const d = DISTROS[distro];
            const distroArch = d.arch[arch];

            if (!distroArch) {
                throw new Error(`Unsupported architecture: ${arch} for distro ${distro}`);
            }

            const architectures = {
                [arch]: {
                    libraryDirectory: arch === "arm64-v8a" ? "arm64" : arch === "armeabi-v7a" ? "arm32" : "x64",
                    axsArchitecture: arch === "arm64-v8a" ? "arm64" : arch === "armeabi-v7a" ? "armv7" : "x86_64",
                    distroDirectory: distroArch.dir,
                    distroFilename: distroArch.file,
                    hasLibproot32: ["arm64-v8a", "x86_64"].includes(arch),
                },
            };

            const architecture = architectures[arch];

            if (!architecture) {
                throw new Error(`Unsupported architecture: ${arch}`);
            }

            const buildUrl = (...parts) => parts.join("");

            const strings = {
                protocol: ["ht", "tps", ":", "//"],

                rawGithubDomain: [
                    "raw",
                    ".",
                    "github",
                    "usercontent",
                    ".",
                    "com"
                ],

                githubDomain: [
                    "git",
                    "hub",
                    ".",
                    "com"
                ],
                acodeFoundation: [
                    "Acode",
                    "-",
                    "Foundation"
                ],

                acodeRepo: [
                    "A",
                    "code"
                ],

                bajrangCoder: [
                    "bajrang",
                    "Coder"
                ],

                acodexServer: [
                    "acodex",
                    "_",
                    "server"
                ],

                libraries: {
                    proot: ["li", "bp", "root", ".", "so"],
                    proot32: ["li", "bp", "root", "32", ".", "so"],
                    talloc: ["li", "bt", "alloc", ".", "so"],
                    prootXed: ["li", "bp", "root", "-", "xed", ".", "so"]
                }
            };

            const rawGithubBase = buildUrl(
                ...strings.protocol,
                ...strings.rawGithubDomain,
                "/",
                ...strings.acodeFoundation,
                "/",
                ...strings.acodeRepo,
                "/main/src/plugins/proot/libs/"
            );

            const githubReleaseBase = buildUrl(
                ...strings.protocol,
                ...strings.githubDomain,
                "/",
                ...strings.bajrangCoder,
                "/",
                ...strings.acodexServer,
                "/releases/latest/download/"
            );

            // Distro rootfs tarball. Debian/Arch/etc do not publish official
            // per-arch minirootfs tarballs at one stable URL. Configure a mirror
            // via DISTRO_ROOTFS_BASE, or bundle `distro_assets/<arch>/<distro>.rootfs`
            // for F-Droid builds.
            let distroBase = "";
            try {
                distroBase = await Executor.execute("echo $DISTRO_ROOTFS_BASE");
            } catch (e) {
                // ignore — distroBase stays empty below
            }
            distroBase = (distroBase || "").trim();
            if (!distroBase) {
                throw new Error(
                    "No distro rootfs mirror configured.\n" +
                    "  F-Droid: bundle distro_assets/<arch>/<distro>.rootfs in the app.\n" +
                    "  Play Store: set DISTRO_ROOTFS_BASE to a mirror hosting rootfs tarballs,\n" +
                    "  e.g. https://example.com/mirrors/ then files are fetched as\n" +
                    "  $DISTRO_ROOTFS_BASE/<arch>/<distro-rootfs>.tar.gz"
                );
            }

            const libraryBaseUrl = buildUrl(
                rawGithubBase,
                architecture.libraryDirectory,
                "/"
            );

            const libproot = buildUrl(
                libraryBaseUrl,
                ...strings.libraries.proot
            );

            const libTalloc = buildUrl(
                libraryBaseUrl,
                ...strings.libraries.talloc
            );

            const prootUrl = buildUrl(
                libraryBaseUrl,
                ...strings.libraries.prootXed
            );

            const libproot32 = architecture.hasLibproot32
                ? buildUrl(
                    libraryBaseUrl,
                    ...strings.libraries.proot32
                )
                : null;

            const axsUrl = buildUrl(
                githubReleaseBase,
                "axs-pie-android-",
                architecture.axsArchitecture
            );

            const distroUrl = buildUrl(
                distroBase,
                architecture.distroDirectory,
                "/",
                architecture.distroFilename
            );

            // Rootfs: try bundled asset first (offline), then mirror download.
            let rootfsGot = false;

            try {
                logger("📦  Extracting bundled distro asset...");
                await new Promise((resolve, reject) => {
                    system.extractAsset(`distro_assets/${architecture.libraryDirectory}/${distro}.rootfs`, `${filesDir}/${distro}.tar.gz`, resolve, (e)=>{
                        reject(e);
                    });
                });
                rootfsGot = true;
                logger("✅  Bundled asset extracted");
            } catch (e) {
                // No bundled asset — fall through to mirror download below.
            }

            if (!rootfsGot) {
                if (!distroBase) {
                    throw new Error(
                        "No distro rootfs configured.\n" +
                        "  Bundle distro_assets/<arch>/<distro>.rootfs in the app, or\n" +
                        "  set DISTRO_ROOTFS_BASE to a mirror hosting rootfs tarballs"
                    );
                }
                logger("⬇️  Downloading sandbox filesystem...");
                await downloadFile(distroUrl, cordova.file.dataDirectory + `${distro}.tar.gz`, "Sandbox filesystem");
                logger("✅  Download complete");
            }

            // Download proot/axs/libtalloc libraries (needed regardless of rootfs source).
            if (isFdroid !== "true") {
                logger("⬇️  Downloading axs...");
                await downloadFile(axsUrl, cordova.file.dataDirectory + "axs", "AXS");
                logger("⬇️  Downloading compatibility layer...");
                await downloadFile(prootUrl, cordova.file.dataDirectory + "libproot-xed.so", "Compatibility layer");
                logger("⬇️  Downloading supporting library...");
                await downloadFile(libTalloc, cordova.file.dataDirectory + "libtalloc.so.2", "Supporting library");
                if (libproot != null) {
                    await downloadFile(libproot, cordova.file.dataDirectory + "libproot.so", "proot loader");
                }
                if (libproot32 != null) {
                    await downloadFile(libproot32, cordova.file.dataDirectory + "libproot32.so", "32-bit proot loader");
                }
                try{
                    await Executor.execute("rm -f $PREFIX/axs && ln -s $NATIVE_DIR/libaxs.so $PREFIX/axs")
                }catch(e){
                    err_logger(`${formatError(e)}`);
                }
            }
           

            logger("📁  Setting up directories...");

            await ensureDir(`${filesDir}/.downloaded`);

            const distroDir = `${filesDir}/distros/${distro}`;

            await ensureDir(distroDir);


            logger("📦  Extracting sandbox filesystem...");
            await Executor.execute(`tar --no-same-owner -xf ${filesDir}/${distro}.tar.gz -C ${distroDir}`);

            logger("⚙️  Applying basic configuration...");
            await writeText(`${distroDir}/etc/resolv.conf`, `nameserver 8.8.4.4 \nnameserver 8.8.8.8`);

            const rmWrapper = await readAsset("rm-wrapper.sh");
            await deleteFile(`${distroDir}/bin/rm`).catch(() => {});
            await writeText(`${distroDir}/bin/rm`, rmWrapper);
            await setExec(`${distroDir}/bin/rm`, true);

            logger("✅  Extraction complete");
            await ensureDir(`${filesDir}/.extracted`);

            logger("⚙️  Updating sandbox enviroment...");
            const installResult = await this.startAxs(true, logger, err_logger, false, distro);
            if (!installResult) {
                throw new Error(this.lastInstallError || "Sandbox configuration failed.");
            }
            return installResult;

        } catch (e) {
            const message = formatError(e);
            this.lastInstallError = message;
            err_logger(`Installation failed: ${message}`);
            console.error("Installation failed:", e);
            return false;
        }
    },

    /**
     * Checks if a distro is already installed.
     * @param {string} [distro] - Distro id (defaults to active distro).
     * @returns {Promise<boolean>} - Returns true if all required files and directories exist.
     */
    isInstalled(distro) {
        distro = distro || activeDistro;
        return new Promise(async (resolve, reject) => {
            const filesDir = await new Promise((resolve, reject) => {
                system.getFilesDir(resolve, reject);
            });

            const distroExists = await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/distros/${distro}`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const downloaded = distroExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.downloaded`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const extracted = distroExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.extracted`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const configured = distroExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.configured`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            resolve(distroExists && downloaded && extracted && configured);
        });
    },

    /**
     * Checks if the current device architecture is supported.
     * @returns {Promise<boolean>} - `true` if architecture is supported, otherwise `false`.
     */
    isSupported() {
        return new Promise((resolve, reject) => {
            system.getArch((arch) => {
                resolve(["arm64-v8a", "armeabi-v7a", "x86_64"].includes(arch));
            }, reject);
        });
    },
    /**
     * Creates a backup of a distro installation
     * @async
     * @function backup
     * @description Creates a compressed tar archive of a distro installation
     * @param {string} [distro] - Distro id (defaults to active distro).
     * @returns {Promise<string>} Promise that resolves to the file URI of the created backup file (aterm_backup.tar)
     * @throws {string} Rejects with "<distro> is not installed." if the distro is not currently installed
     * @throws {string} Rejects with command output if backup creation fails
     * @example
     * try {
     *   const backupPath = await backup();
     *   console.log(`Backup created at: ${backupPath}`);
     * } catch (error) {
     *   console.error(`Backup failed: ${error}`);
     * }
     */
    backup(distro) {
        distro = distro || activeDistro;
        return new Promise(async (resolve, reject) => {
            if (!await this.isInstalled(distro)) {
                reject(`${distro} is not installed.`);
                return;
            }
            const cmd = `
            set -e
            INCLUDE_FILES="distros/${distro} .downloaded .extracted .configured axs"
            if [ "$FDROID" = "true" ]; then
                INCLUDE_FILES="$INCLUDE_FILES libtalloc.so.2 libproot-xed.so"
            fi
            EXCLUDE="--exclude=distros/${distro}/data --exclude=distros/${distro}/system --exclude=distros/${distro}/vendor --exclude=distros/${distro}/sdcard --exclude=distros/${distro}/storage --exclude=distros/${distro}/public --exclude=distros/${distro}/apex --exclude=distros/${distro}/odm --exclude=distros/${distro}/product --exclude=distros/${distro}/system_ext --exclude=distros/${distro}/linkerconfig --exclude=distros/${distro}/proc --exclude=distros/${distro}/sys --exclude=distros/${distro}/dev --exclude=distros/${distro}/run --exclude=distros/${distro}/tmp"
            tar -cf "$PREFIX/aterm_backup.tar" -C "$PREFIX" $EXCLUDE $INCLUDE_FILES
            echo "ok"
            `;
            const result = await Executor.execute(cmd);
            if (result === "ok") {
                resolve(cordova.file.dataDirectory + "aterm_backup.tar");
            } else {
                reject(result);
            }
        });
    },
    /**
     * Restores a distro installation from a backup file
     * @async
     * @function restore
     * @description Restores a distro installation from a previously created backup file (aterm_backup.tar).
     * This function stops any running processes, removes existing installation files, and extracts
     * the backup to restore the previous state. The backup file must exist in the expected location.
     * @param {string} [distro] - Distro id (defaults to active distro).
     * @returns {Promise<string>} Promise that resolves to "ok" when restoration completes successfully
     * @throws {string} Rejects with "Backup File does not exist" if aterm_backup.tar is not found
     * @throws {string} Rejects with command output if restoration fails
     * @example
     * try {
     *   await restore();
     *   console.log("Distro installation restored successfully");
     * } catch (error) {
     *   console.error(`Restore failed: ${error}`);
     * }
     */
    restore(distro) {
        distro = distro || activeDistro;
        return new Promise(async (resolve, reject) => {
            if (await this.isAxsRunning()) {
                await this.stopAxs();
            }

            const cmd = `
            set -e

            INCLUDE_FILES="$PREFIX/distros/${distro} $PREFIX/.downloaded $PREFIX/.extracted $PREFIX/.configured $PREFIX/axs"

            if [ "$FDROID" = "true" ]; then
                INCLUDE_FILES="$INCLUDE_FILES $PREFIX/libtalloc.so.2 $PREFIX/libproot-xed.so"
            fi

            for item in $INCLUDE_FILES; do
                rm -rf -- "$item"
            done

            tar -xf $PREFIX/aterm_backup.* -C "$PREFIX"
            echo "ok"
            `;

            const result = await Executor.BackgroundExecutor.execute(cmd);
            if (result === "ok") {
                resolve(result);
            } else {
                reject(result);
            }
        });
    },
    /**
     * Uninstalls a distro installation
     * @async
     * @function uninstall
     * @description Completely removes a distro installation from the device by deleting all
     * distro-related files and directories. This function stops any running processes before
     * removal. NOTE: This does not perform cleanup of $PREFIX
     * @param {string} [distro] - Distro id (defaults to active distro).
     * @returns {Promise<string>} Promise that resolves to "ok" when uninstallation completes successfully
     * @throws {string} Rejects with command output if uninstallation fails
     * @example
     * try {
     *   await uninstall();
     *   console.log("Distro installation removed successfully");
     * } catch (error) {
     *   console.error(`Uninstall failed: ${error}`);
     * }
     */
    uninstall(distro) {
        distro = distro || activeDistro;
        return new Promise(async (resolve, reject) => {
            if (await this.isAxsRunning()) {
                await this.stopAxs();
            }

            const cmd = `
            set -e

            INCLUDE_FILES="$PREFIX/distros/${distro} $PREFIX/.downloaded $PREFIX/.extracted $PREFIX/.configured $PREFIX/axs"

            if [ "$FDROID" = "true" ]; then
                INCLUDE_FILES="$INCLUDE_FILES $PREFIX/libtalloc.so.2 $PREFIX/libproot-xed.so"
            fi

            for item in $INCLUDE_FILES; do
                rm -rf -- "$item"
            done

            echo "ok"
            `;
            const result = await Executor.BackgroundExecutor.execute(cmd);
            if (result === "ok") {
                resolve(result);
            } else {
                reject(result);
            }
        });
    },

    /**
     * Migrates the legacy terminal home directories into public/MIGRATE.
     * Older builds stored user files under <distro>/home and <distro>/root.
     * After /home, /root and /public were merged into a single public
     * directory, any files still left in the old locations are copied
     * into public/MIGRATE (keeping their source structure) so nothing is
     * hidden or lost. This is a no-op once the migration has run.
     * @returns {Promise<void>}
     */
    async migrateLegacyHome() {
        if (this._legacyHomeMigrated) return;
        try {
            const cmd = `
                MIGRATE="$PREFIX/public/MIGRATE"

                # Already migrated
                [ -e "$MIGRATE/.migrated" ] && exit 0

                COPIED=false

                if [ -d "$PREFIX/distros/${activeDistro}/home" ] && [ -n "$(find "$PREFIX/distros/${activeDistro}/home" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
                    mkdir -p "$MIGRATE/home"
                    if cp -a "$PREFIX/distros/${activeDistro}/home/." "$MIGRATE/home/"; then
                        COPIED=true
                    else
                        exit 1
                    fi
                fi

                if [ -d "$PREFIX/distros/${activeDistro}/root" ] && [ -n "$(find "$PREFIX/distros/${activeDistro}/root" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
                    mkdir -p "$MIGRATE/root"
                    if cp -a "$PREFIX/distros/${activeDistro}/root/." "$MIGRATE/root/"; then
                        COPIED=true
                    else
                        exit 1
                    fi
                fi

                # Mark as migrated so this only runs once
                if [ "$COPIED" = "true" ]; then
                    touch "$MIGRATE/.migrated"
                fi
            `;
            await Executor.BackgroundExecutor.execute(cmd);
            this._legacyHomeMigrated = true;
        } catch (error) {
            console.error("Failed to migrate legacy terminal home:", formatError(error));
        }
    },

    formatError
};


function readAsset(assetPath, callback) {
    const assetUrl = "file:///android_asset/" + assetPath;

    const promise = new Promise((resolve, reject) => {
        window.resolveLocalFileSystemURL(assetUrl, fileEntry => {
            fileEntry.file(file => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error || new Error(`Failed to read ${assetPath}`));
                reader.readAsText(file);
            }, reject);
        }, reject);
    });

    if (callback) {
        promise.then(callback).catch(console.error);
    }

    return promise;
}

function fileExists(path) {
    return new Promise((resolve, reject) => {
        system.fileExists(path, false, (result) => {
            resolve(result == 1);
        }, reject);
    });
}

async function ensureDir(path) {
    if (await fileExists(path)) return;

    await new Promise((resolve, reject) => {
        system.mkdirs(path, resolve, reject);
    });
}

function writeText(path, content) {
    return new Promise((resolve, reject) => {
        system.writeText(path, content, resolve, reject);
    });
}

function deleteFile(path) {
    return new Promise((resolve, reject) => {
        system.deleteFile(path, resolve, reject);
    });
}

function setExec(path, executable) {
    return new Promise((resolve, reject) => {
        system.setExec(path, executable, resolve, reject);
    });
}

function downloadFile(url, destination, label) {
    return new Promise((resolve, reject) => {
        cordova.plugin.http.downloadFile(
            url, {}, {},
            destination,
            resolve,
            (error) => reject(new Error(`${label} download failed: ${formatError(error)}`))
        );
    });
}

function formatError(error) {
    if (error == null) return "Unknown error";
    if (error instanceof Error) return error.message || String(error);
    if (typeof error === "string") return error || "Unknown error";
    if (typeof error === "object") {
        const parts = [];
        if (error.status != null) parts.push(`status ${error.status}`);
        if (error.error) parts.push(String(error.error));
        if (error.message) parts.push(String(error.message));
        if (error.exception) parts.push(String(error.exception));
        if (error.url) parts.push(`URL: ${error.url}`);
        if (parts.length) return parts.join(" - ");

        try {
            return JSON.stringify(error);
        } catch (jsonError) {
            return String(error);
        }
    }

    return String(error);
}

module.exports = Terminal;
