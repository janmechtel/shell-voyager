#!/usr/bin/env node
import { execSync } from "child_process";

interface CommandEntry {
	time: number; // Unix timestamp or string representation
	exitCode: number;
	command: string;
	isAi: boolean;
}

function fetchHistory(): CommandEntry[] {
	// Use print0 for safe multiline parsing
	const formatStr = "{time}\t{exit}\t{command}";
	const stdout = execSync(
		`atuin search --cwd . --limit 10000 --format "${formatStr}" --print0`,
		{
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024, // 10MB
		},
	);

	const entries: CommandEntry[] = [];
	const rawEntries = stdout.split("\0");

	for (const raw of rawEntries) {
		if (!raw.trim()) continue;
		const firstTab = raw.indexOf("\t");
		const secondTab = raw.indexOf("\t", firstTab + 1);

		if (firstTab === -1 || secondTab === -1) continue;

		const timeStr = raw.substring(0, firstTab).trim();
		const exitStr = raw.substring(firstTab + 1, secondTab).trim();
		const command = raw.substring(secondTab + 1).trim();

		// Check if it's AI
		const isAi = command.includes("#ai");
		let cleanCommand = command;
		if (isAi) {
			cleanCommand = cleanCommand.replace(/#ai\s*$/, "").trim();
			// Remove the export GIT_TERMINAL_PROMPT=0 injected by entire
			cleanCommand = cleanCommand
				.replace(/^export GIT_TERMINAL_PROMPT=0(?:\\n|\n)/, "")
				.trim();
		}

		entries.push({
			time: new Date(timeStr).getTime(),
			exitCode: parseInt(exitStr, 10),
			command: cleanCommand,
			isAi,
		});
	}

	// Sort by time ascending
	entries.sort((a, b) => a.time - b.time);
	return entries;
}

function normalizeCommand(cmd: string): string {
	// Very naive normalization for the MVP
	// e.g., "pytest test_foo.py" -> "pytest"
	// e.g., "npm run test" -> "npm run test"
	const parts = cmd.split(/\s+/);
	if (parts.length === 0) return "";

	const first = parts[0];

	// Special cases for commands where we usually want to keep the subcommand
	if (
		["npm", "yarn", "pnpm", "git", "cargo", "docker", "kubectl"].includes(first)
	) {
		if (parts.length > 1) {
			if (first === "npm" && parts[1] === "run" && parts.length > 2) {
				return `${first} run ${parts[2]}`;
			}
			return `${first} ${parts[1]}`;
		}
		return first;
	}

	// For other commands, we'll just keep the first word (the executable)
	return first;
}

function analyze(entries: CommandEntry[]) {
	const normalizedCounts: Record<
		string,
		{ count: number; aiCount: number; originalExamples: Set<string> }
	> = {};

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];

		// Filter out genuine bad commands
		if (entry.exitCode === 2 || entry.exitCode === 127) {
			continue;
		}

		// Heuristic: If AI runs a command, fails, and runs another shortly after, skip the failed one.
		// For MVP, we'll just skip all non-zero exit commands for AI to be safe, unless it's a test.
		// Actually, let's keep it simple: skip exitCode 2 and 127 for everyone.

		const normalized = normalizeCommand(entry.command);
		if (!normalized) continue;

		if (!normalizedCounts[normalized]) {
			normalizedCounts[normalized] = {
				count: 0,
				aiCount: 0,
				originalExamples: new Set(),
			};
		}

		normalizedCounts[normalized].count++;
		if (entry.isAi) {
			normalizedCounts[normalized].aiCount++;
		}

		// Keep up to 3 original examples for context
		if (normalizedCounts[normalized].originalExamples.size < 3) {
			normalizedCounts[normalized].originalExamples.add(entry.command);
		}
	}

	// Sort by frequency
	const sorted = Object.entries(normalizedCounts).sort(
		(a, b) => b[1].count - a[1].count,
	);

	console.log("🌟 Voyager Cheat Sheet for current directory 🌟\n");
	if (sorted.length === 0) {
		console.log("No useful commands found yet. Start running things!");
		return;
	}

	for (const [norm, stats] of sorted) {
		const aiTag = stats.aiCount > 0 ? ` [🤖 AI used ${stats.aiCount}x]` : "";
		console.log(`\x1b[1m${norm}\x1b[0m (used ${stats.count} times)${aiTag}`);
		for (const ex of stats.originalExamples) {
			// truncate long examples
			const truncated = ex.length > 60 ? `${ex.substring(0, 57)}...` : ex;
			console.log(`  └─ ${truncated.replace(/\n/g, " ")}`);
		}
		console.log("");
	}
}

try {
	const history = fetchHistory();
	analyze(history);
} catch (e: any) {
	console.error("Failed to generate cheat sheet:", e.message);
}
