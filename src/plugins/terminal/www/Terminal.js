const Executor = require("./Executor");

const Terminal = {
    /**
     * Starts the AXS environment by writing init scripts and executing the sandbox.
     * @param {boolean} [installing=false] - Whether AXS is being started during installation.
     * @param {Function} [logger=console.log] - Function to log standard output.
     * @param {Function} [err_logger=console.error] - Function to log errors.
     * @returns {Promise<boolean>} - Returns true if installation completes with exit code 0, void if not installing
     */
    async startAxs(installing = false, logger = console.log, err_logger = console.error,failsafe = false) {
        const filesDir = await new Promise((resolve, reject) => {
            system.getFilesDir(resolve, reject);
        });

        const failsafeArg = failsafe ? "--failsafe" : "";

        const [initDebian, rmWrapper, initSandbox] = await Promise.all([
            readAsset("init-debian.sh"),
            readAsset("rm-wrapper.sh"),
            readAsset("init-sandbox.sh"),
        ]);

        await this.migrateLegacyHome();

        const isFdroid = await Executor.execute("echo $FDROID");

        if(isFdroid !== "true"){
//the symlink must be updated everytime because the symlinks to native libs can break after app updates
        await Executor.execute("rm -f $PREFIX/axs && ln -s $NATIVE_DIR/libaxs.so $PREFIX/axs")
}
        

        await writeText(`${filesDir}/init-debian.sh`, initDebian);
        await writeText(`${filesDir}/init-sandbox.sh`, initSandbox);

        await deleteFile(`${filesDir}/debian/bin/rm`).catch(() => {});
        await writeText(`${filesDir}/debian/bin/rm`, rmWrapper);
        await setExec(`${filesDir}/alpine/bin/rm`, true);

        if (installing) {
            return new Promise((resolve, reject) => {
                let lastError = "";

                Executor.start("sh", (type, data) => {
                    //console[type === "stderr" ? "error" : "log"](`[AXS] ${data}`);
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
                    await Executor.write(uuid, `source ${filesDir}/init-sandbox.sh ${installing ? "--installing" : ""} ${failsafeArg}; exit`);
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
                    //console[type === "stderr" ? "error" : "log"](`[AXS] ${data}`);
                    logger(`${type} ${data}`);
                });
                await Executor.write(uuid, `source ${filesDir}/init-sandbox.sh ${installing ? "--installing" : ""} ${failsafeArg}; exit`);
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
    async install(logger = console.log, err_logger = console.error) {
        if (!(await this.isSupported())) return false;

        const isFdroid = await Executor.execute("echo $FDROID");

        this.lastInstallError = "";

        try {
            //cleanup before insatll
            await this.uninstall();
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

            const architectures = {
                "arm64-v8a": {
                    libraryDirectory: "arm64",
                    axsArchitecture: "arm64",
                    debianDirectory: "arm64",
                    debianFilename: "debian-rootfs-arm64.tar.gz",
                    hasLibproot32: true
                },

                "armeabi-v7a": {
                    libraryDirectory: "arm32",
                    axsArchitecture: "armv7",
                    debianDirectory: "armhf",
                    debianFilename: "debian-rootfs-armhf.tar.gz",
                    hasLibproot32: false
                },

                "x86_64": {
                    libraryDirectory: "x64",
                    axsArchitecture: "x86_64",
                    debianDirectory: "amd64",
                    debianFilename: "debian-rootfs-amd64.tar.gz",
                    hasLibproot32: true
                }
            };

            const architecture = architectures[arch];

            if (!architecture) {
                throw new Error(`Unsupported architecture: ${arch}`);
            }

            if(isFdroid === "true") {
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

                debianDomain: [
                    "deb",
                    ".",
                    "debian",
                    ".",
                    "org"
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

            // Debian does not publish official per-arch minirootfs tarballs the way Alpine does.
            // Point debianBase at a mirror hosting a Debian rootfs tarball per architecture,
            // or bundle `debian_assets/<arch>/debian.rootfs` for F-Droid builds.
            const debianBase = buildUrl(
                ...strings.protocol,
                ...strings.debianDomain,
                "/debian/"
            );

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

            const debianUrl = buildUrl(
                debianBase,
                architecture.debianDirectory,
                "/",
                architecture.debianFilename
            );

                logger("⬇️  Downloading sandbox filesystem...");
                await downloadFile(debianUrl, cordova.file.dataDirectory + "debian.tar.gz", "Sandbox filesystem");

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

                logger("✅  All downloads completed");
            }else{
                logger("📦  Extracting assets...");
                await new Promise((resolve, reject) => {
                    system.extractAsset(`debian_assets/${architecture.libraryDirectory}/debian.rootfs`, `${filesDir}/debian.tar.gz`, resolve, (e)=>{
                        console.error(`Failed to extract debian.tar.gz: ${formatError(e)}`);
                        reject(e);
                    });
                });

                try{
                    await Executor.execute("rm -f $PREFIX/axs && ln -s $NATIVE_DIR/libaxs.so $PREFIX/axs")
                }catch(e){
                    err_logger(`${formatError(e)}`);
                }
            }
           

            logger("📁  Setting up directories...");

            await ensureDir(`${filesDir}/.downloaded`);

            const debianDir = `${filesDir}/debian`;

            await ensureDir(debianDir);


            logger("📦  Extracting sandbox filesystem...");
            await Executor.execute(`tar --no-same-owner -xf ${filesDir}/debian.tar.gz -C ${debianDir}`);

            logger("⚙️  Applying basic configuration...");
            await writeText(`${debianDir}/etc/resolv.conf`, `nameserver 8.8.4.4 \nnameserver 8.8.8.8`);

            const rmWrapper = await readAsset("rm-wrapper.sh");
            await deleteFile(`${debianDir}/bin/rm`).catch(() => {});
            await writeText(`${debianDir}/bin/rm`, rmWrapper);
            await setExec(`${debianDir}/bin/rm`, true);

            logger("✅  Extraction complete");
            await ensureDir(`${filesDir}/.extracted`);

            logger("⚙️  Updating sandbox enviroment...");
            const installResult = await this.startAxs(true, logger, err_logger);
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
     * Checks if debian is already installed.
     * @returns {Promise<boolean>} - Returns true if all required files and directories exist.
     */
    isInstalled() {
        return new Promise(async (resolve, reject) => {
            const filesDir = await new Promise((resolve, reject) => {
                system.getFilesDir(resolve, reject);
            });

            const debianExists = await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/debian`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const downloaded = debianExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.downloaded`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const extracted = debianExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.extracted`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            const configured = debianExists && await new Promise((resolve, reject) => {
                system.fileExists(`${filesDir}/.configured`, false, (result) => {
                    resolve(result == 1);
                }, reject);
            });

            resolve(debianExists && downloaded && extracted && configured);
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
     * Creates a backup of the Debian Linux installation
     * @async
     * @function backup
     * @description Creates a compressed tar archive of the Debian installation
     * @returns {Promise<string>} Promise that resolves to the file URI of the created backup file (aterm_backup.tar)
     * @throws {string} Rejects with "Debian is not installed." if Debian is not currently installed
     * @throws {string} Rejects with command output if backup creation fails
     * @example
     * try {
     *   const backupPath = await backup();
     *   console.log(`Backup created at: ${backupPath}`);
     * } catch (error) {
     *   console.error(`Backup failed: ${error}`);
     * }
     */
    backup() {
        return new Promise(async (resolve, reject) => {
            if (!await this.isInstalled()) {
                reject("Debian is not installed.");
                return;
            }
            const cmd = `
            set -e
            INCLUDE_FILES="debian .downloaded .extracted .configured axs"
            if [ "$FDROID" = "true" ]; then
                INCLUDE_FILES="$INCLUDE_FILES libtalloc.so.2 libproot-xed.so"
            fi
            EXCLUDE="--exclude=debian/data --exclude=debian/system --exclude=debian/vendor --exclude=debian/sdcard --exclude=debian/storage --exclude=debian/public --exclude=debian/apex --exclude=debian/odm --exclude=debian/product --exclude=debian/system_ext --exclude=debian/linkerconfig --exclude=debian/proc --exclude=debian/sys --exclude=debian/dev --exclude=debian/run --exclude=debian/tmp"
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
     * Restores Debian Linux installation from a backup file
     * @async
     * @function restore
     * @description Restores the Debian installation from a previously created backup file (aterm_backup.tar).
     * This function stops any running Debian processes, removes existing installation files, and extracts
     * the backup to restore the previous state. The backup file must exist in the expected location.
     * @returns {Promise<string>} Promise that resolves to "ok" when restoration completes successfully
     * @throws {string} Rejects with "Backup File does not exist" if aterm_backup.tar is not found
     * @throws {string} Rejects with command output if restoration fails
     * @example
     * try {
     *   await restore();
     *   console.log("Debian installation restored successfully");
     * } catch (error) {
     *   console.error(`Restore failed: ${error}`);
     * }
     */
    restore() {
        return new Promise(async (resolve, reject) => {
            if (await this.isAxsRunning()) {
                await this.stopAxs();
            }

            const cmd = `
            set -e

            INCLUDE_FILES="$PREFIX/debian $PREFIX/.downloaded $PREFIX/.extracted $PREFIX/.configured $PREFIX/axs"

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
     * Uninstalls the Alpine Linux installation
     * @async
     * @function uninstall
     * @description Completely removes the Alpine Linux installation from the device by deleting all
     * Debian-related files and directories. This function stops any running Debian processes before
     * removal. NOTE: This does not perform cleanup of $PREFIX
     * @returns {Promise<string>} Promise that resolves to "ok" when uninstallation completes successfully
     * @throws {string} Rejects with command output if uninstallation fails
     * @example
     * try {
     *   await uninstall();
     *   console.log("Debian installation removed successfully");
     * } catch (error) {
     *   console.error(`Uninstall failed: ${error}`);
     * }
     */
    uninstall() {
        return new Promise(async (resolve, reject) => {
            if (await this.isAxsRunning()) {
                await this.stopAxs();
            }

            const cmd = `
            set -e

            INCLUDE_FILES="$PREFIX/debian $PREFIX/.downloaded $PREFIX/.extracted $PREFIX/.configured $PREFIX/axs"

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
     * Older builds stored user files under debian/home and debian/root.
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

                if [ -d "$PREFIX/debian/home" ] && [ -n "$(find "$PREFIX/debian/home" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
                    mkdir -p "$MIGRATE/home"
                    if cp -a "$PREFIX/debian/home/." "$MIGRATE/home/"; then
                        COPIED=true
                    else
                        exit 1
                    fi
                fi

                if [ -d "$PREFIX/debian/root" ] && [ -n "$(find "$PREFIX/debian/root" -mindepth 1 -maxdepth 1 2>/dev/null | head -n 1)" ]; then
                    mkdir -p "$MIGRATE/root"
                    if cp -a "$PREFIX/debian/root/." "$MIGRATE/root/"; then
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
