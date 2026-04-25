#!/usr/bin/env node
import { execSync } from "child_process";
import { Box, render, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import { useMemo, useState } from "react";

interface CommandEntry {
	time: number;
	exitCode: number;
	command: string;
	isAi: boolean;
}

function fetchHistory(): CommandEntry[] {
	const formatStr = "{time}\t{exit}\t{command}";
	const stdout = execSync(
		`atuin search --cwd . --limit 10000 --format "${formatStr}" --print0`,
		{
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
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

		const isAi = command.includes("#ai");
		let cleanCommand = command;
		if (isAi) {
			cleanCommand = cleanCommand.replace(/#ai\s*$/, "").trim();
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

	entries.sort((a, b) => b.time - a.time);
	return entries;
}

function normalizeCommand(cmd: string): { cmd: string; params: string } {
	const trimmed = cmd.trim();
	const parts = trimmed.split(/\s+/);
	if (parts.length === 0 || !parts[0]) return { cmd: "", params: "" };

	const first = parts[0];
	let numParts = 1;

	if (
		["npm", "yarn", "pnpm", "git", "cargo", "docker", "kubectl"].includes(first)
	) {
		if (parts.length > 1) {
			if (first === "npm" && parts[1] === "run" && parts.length > 2) {
				numParts = 3;
			} else {
				numParts = 2;
			}
		}
	}

	const normalizedCmd = parts.slice(0, numParts).join(" ");

	let idx = 0;
	for (let i = 0; i < numParts; i++) {
		idx = trimmed.indexOf(parts[i], idx) + parts[i].length;
	}
	const params = trimmed.substring(idx).trim();

	return { cmd: normalizedCmd, params };
}

interface CommandStat {
	cmd: string;
	count: number;
	aiCount: number;
	maxCount: number;
	params: string;
}

function analyze(entries: CommandEntry[]): CommandStat[] {
	const normalizedCounts: Record<
		string,
		{ count: number; aiCount: number; paramCounts: Record<string, number> }
	> = {};

	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.exitCode === 2 || entry.exitCode === 127) {
			continue;
		}

		const { cmd: normalized, params } = normalizeCommand(entry.command);
		if (!normalized) continue;

		if (!normalizedCounts[normalized]) {
			normalizedCounts[normalized] = { count: 0, aiCount: 0, paramCounts: {} };
		}

		normalizedCounts[normalized].count++;
		if (entry.isAi) {
			normalizedCounts[normalized].aiCount++;
		}

		if (params) {
			normalizedCounts[normalized].paramCounts[params] =
				(normalizedCounts[normalized].paramCounts[params] || 0) + 1;
		}
	}

	const sorted = Object.entries(normalizedCounts).sort(
		(a, b) => b[1].count - a[1].count,
	);
	const maxCount = sorted.length > 0 ? sorted[0][1].count : 0;

	return sorted.map(([cmd, stats]) => {
		const sortedParams = Object.entries(stats.paramCounts)
			.sort((a, b) => b[1] - a[1])
			.map((x) => x[0]);
		return {
			cmd,
			count: stats.count,
			aiCount: stats.aiCount,
			maxCount,
			params: sortedParams.join(", "),
		};
	});
}

const App = ({
	items,
	onSelect,
}: {
	items: CommandStat[];
	onSelect: (cmd: string) => void;
}) => {
	const { exit } = useApp();
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isExiting, setIsExiting] = useState(false);

	const filteredItems = useMemo(() => {
		if (!query) return items;
		const lowerQuery = query.toLowerCase();
		return items.filter((i) => i.cmd.toLowerCase().includes(lowerQuery));
	}, [items, query]);

	useInput((_input, key) => {
		if (key.upArrow) {
			setSelectedIndex(Math.max(0, selectedIndex - 1));
		} else if (key.downArrow) {
			setSelectedIndex(Math.min(filteredItems.length - 1, selectedIndex + 1));
		} else if (key.return) {
			const selected = filteredItems[selectedIndex];
			setIsExiting(true);
			exit();
			if (selected) {
				onSelect(selected.cmd);
			}
		} else if (key.escape) {
			setIsExiting(true);
			exit();
		}
	});

	if (isExiting) {
		return null;
	}

	let maxCmdLen = 10;
	for (const item of items) {
		if (item.cmd.length > maxCmdLen) {
			maxCmdLen = item.cmd.length;
		}
	}
	maxCmdLen = Math.min(maxCmdLen, 60);

	return (
		<Box flexDirection="column" padding={1} width="100%">
			<Box flexDirection="column" marginBottom={1}>
				<Text color="yellow" bold>
					🌟 Voyager Cheat Sheet 🌟
				</Text>
				<Box>
					<Text color="cyan">Search: </Text>
					<TextInput
						value={query}
						onChange={(q) => {
							setQuery(q);
							setSelectedIndex(0);
						}}
					/>
				</Box>
			</Box>

			<Box flexDirection="column" width="100%">
				<Box width="100%">
					<Text bold wrap="truncate">
						{"Command".padEnd(maxCmdLen, " ")} | {"Frequency".padEnd(20, " ")} |
						🤖 AI | Count | Parameters
					</Text>
				</Box>
				<Box width="100%">
					<Text dimColor wrap="truncate">
						{"-".repeat(maxCmdLen + 2)}+{"-".repeat(22)}
						+-------+-------+------------
					</Text>
				</Box>

				{filteredItems.slice(0, 15).map((item, index) => {
					const isSelected = index === selectedIndex;
					const barLength =
						item.maxCount > 0
							? Math.round((item.count / item.maxCount) * 20)
							: 0;
					const barStr = "█".repeat(barLength).padEnd(20, " ");
					const aiTag =
						item.aiCount > 0
							? item.aiCount.toString().padStart(4, " ")
							: "    ";
					const countStr = item.count.toString().padStart(5, " ");
					const cmdStr = item.cmd
						.padEnd(maxCmdLen, " ")
						.substring(0, maxCmdLen);

					return (
						<Box key={item.cmd} width="100%">
							<Box flexShrink={0}>
								<Text
									color={isSelected ? "green" : undefined}
									bold={isSelected}
								>
									{isSelected ? "> " : "  "}
									{cmdStr} |
								</Text>
								<Text color="cyan"> {barStr} </Text>
								<Text color={isSelected ? "green" : undefined}>
									| {aiTag} | {countStr} |{" "}
								</Text>
							</Box>
							<Box flexGrow={1} flexShrink={1} overflow="hidden">
								<Text color="gray" wrap="truncate">
									{item.params}
								</Text>
							</Box>
						</Box>
					);
				})}
				{filteredItems.length === 0 && (
					<Box marginTop={1}>
						<Text dimColor>No matches found</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
};

async function run() {
	try {
		const history = fetchHistory();
		const stats = analyze(history);

		let selectedCommand: string | null = null;

		// Save cursor position
		process.stderr.write("\x1b[s");

		const { waitUntilExit, unmount } = render(
			<App
				items={stats}
				onSelect={(cmd) => {
					selectedCommand = cmd;
				}}
			/>,
			{ stdout: process.stderr },
		);

		await waitUntilExit();

		// Clean up ink and restore cursor
		unmount();
		process.stderr.write("\x1b[u\x1b[J");

		if (selectedCommand) {
			process.stdout.write(selectedCommand);
		}
	} catch (e: any) {
		process.stderr.write("\x1b[u\x1b[J");
		console.error("Failed to load voyager:", e.message);
	}
}

run();
