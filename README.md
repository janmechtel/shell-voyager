# Shell Voyager

A system that learns from shell commands, acting as an automatic cheat sheet of frequently used and successful commands per working directory. This helps both the user and the AI (like Pi.dev) remember useful workflows.

Inspired by NVIDIA's Voyager, this tool tracks shell history, identifies successful commands, and tags AI-generated ones. 

## Components

### 1. Pi Extension
A Pi.dev extension that intercepts `bash` tool calls made by the AI, runs them normally, but wraps them in `atuin history start` and `atuin history end`. It tags AI-executed commands with `#ai` before sending them to Atuin.

Location: `.pi/extensions/voyager/index.ts`

### 2. Cheat Sheet CLI (`voyager`)
A standalone CLI tool that uses Atuin to pull shell history for the current directory. It normalizes commands, filters out genuine bad commands (syntax errors, typos), and displays a cheat sheet of useful commands, explicitly highlighting the ones heavily used by the AI.

Location: `src/cli.ts` (compiled to `dist/cli.js`)

## Installation

```bash
npm install
npm run build
npm link
```

This will link the `voyager` binary globally so you can run it in any directory.

## Usage

Simply run:
```bash
voyager
```
in any project directory to see a summary of the most useful commands that you and the AI have executed successfully in that directory.

## How it works

1. The user uses the terminal with Atuin enabled (as usual).
2. The AI (Pi.dev) runs commands in the background. The Pi extension intercepts these and injects Atuin history wrappers with an AI tag.
3. The `voyager` CLI pulls history using `atuin search --cwd .`, parses out exit codes, filters commands that threw bash/command-not-found errors (exit 2 or 127), and aggregates the history.
