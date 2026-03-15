import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: false,
    name: 'Dealia',
    executableName: 'Dealia',
    icon: './src/assets/icon',
  },
  rebuildConfig: {},
  hooks: {
    prePackage: async () => {
      const { build } = require('vite');
      const path = require('path');

      console.log('[prePackage] Building renderer for production...');

      // Build the renderer using Vite (outputs to dist/)
      await build({
        configFile: path.join(__dirname, 'vite.renderer.config.mts'),
      });

      console.log('[prePackage] Renderer built successfully to dist/');
    },
    packageAfterCopy: async (_config, buildPath) => {
      const fs = require('fs-extra');
      const path = require('path');

      console.log('[packageAfterCopy] Copying renderer files...');

      // Copy renderer files from dist/ to package
      const distPath = path.join(__dirname, 'dist');
      const rendererPath = path.join(buildPath, '.vite/renderer/main_window');

      await fs.ensureDir(rendererPath);
      await fs.copy(distPath, rendererPath);

      console.log('[packageAfterCopy] Renderer files copied');

      // Copy better-sqlite3 and its dependencies
      const modulesToCopy = ['better-sqlite3', 'bindings', 'prebuild-install', 'file-uri-to-path'];

      for (const moduleName of modulesToCopy) {
        const sourcePath = path.join(__dirname, 'node_modules', moduleName);
        const destPath = path.join(buildPath, 'node_modules', moduleName);
        if (await fs.pathExists(sourcePath)) {
          await fs.copy(sourcePath, destPath);
        }
      }
    },
  },
  makers: [
    new MakerDMG({ format: 'ULFO' }, ['darwin']),
    new MakerZIP({}, ['darwin']),
    new MakerSquirrel({}),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      // Renderer is built manually in prePackage hook to avoid dev server startup issues
      // For development, use concurrently to manage Vite separately
      renderer: [],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};

export default config;
