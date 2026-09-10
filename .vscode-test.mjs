import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	// Oldest VS Code supported by the extension (cf. `engines.vscode`)
	version: '1.125.0',
	mocha: {
		ui: 'tdd',
		// Live tests against a local IdentityIQ may be slow
		timeout: 60_000
	}
});
