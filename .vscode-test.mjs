import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	mocha: {
		ui: 'tdd',
		// Live tests against a local IdentityIQ may be slow
		timeout: 60_000
	}
});
