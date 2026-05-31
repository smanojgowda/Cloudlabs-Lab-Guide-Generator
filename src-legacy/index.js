#!/usr/bin/env node
/**
 * CLI entry point — Record Mode
 *
 * Usage:
 *   node src/index.js serve          # Start web UI (recommended)
 *   node src/index.js record         # Start recording session from CLI
 */
import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { startSession, recordStep, stopAndGenerate, closeBrowser } from './agent/orchestrator.js';
import { close } from './core/browser.js';
import logger from './utils/logger.js';
import { createInterface } from 'readline';

loadEnv();

const program = new Command();

program
  .name('lab-guide-agent')
  .description('Record Mode — perform Azure tasks, capture screenshots, generate CloudLabs-format lab guides')
  .version('4.0.0');

program
  .command('serve')
  .description('Start the web UI for recording sessions')
  .action(async () => {
    await import('./server.js');
  });

program
  .command('record')
  .description('Start an interactive recording session from the CLI')
  .option('-u, --url <url>', 'Starting URL', 'https://portal.azure.com')
  .option('-t, --title <title>', 'Lab title', 'Lab 01: Azure Lab Guide')
  .option('-d, --description <desc>', 'Lab description', '')
  .action(async (opts) => {
    try {
      await startSession({ url: opts.url, title: opts.title, description: opts.description });

      console.log('\n═══ Record Mode ═══');
      console.log('Commands:');
      console.log('  c [description]  — Capture current screen as a step');
      console.log('  g                — Stop recording & generate guide');
      console.log('  q                — Quit without generating');
      console.log('');

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const prompt = () => rl.question('record> ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed) { prompt(); return; }

        const cmd = trimmed[0].toLowerCase();
        const arg = trimmed.slice(1).trim();

        if (cmd === 'c') {
          try {
            const step = await recordStep(arg || undefined);
            console.log(`  Captured step ${step.stepNumber}: ${step.screenshotFilename}`);
          } catch (err) {
            console.error(`  Error: ${err.message}`);
          }
          prompt();
        } else if (cmd === 'g') {
          try {
            console.log('\nGenerating guide...');
            const result = await stopAndGenerate({ title: opts.title, description: opts.description });
            console.log(`\nGuide generated: ${result.markdownPath}`);
          } catch (err) {
            console.error(`Error: ${err.message}`);
          }
          rl.close();
          await close();
        } else if (cmd === 'q') {
          console.log('Quitting without generating.');
          rl.close();
          await closeBrowser();
        } else {
          console.log('Unknown command. Use c, g, or q.');
          prompt();
        }
      });

      prompt();
    } catch (err) {
      logger.error(`Fatal: ${err.message}`);
      await close();
      process.exitCode = 1;
    }
  });

// Default: show help or start serve
program
  .option('--serve', 'Start web server')
  .action(async (opts) => {
    if (opts.serve) {
      await import('./server.js');
      return;
    }
    program.help();
  });

program.parse();
