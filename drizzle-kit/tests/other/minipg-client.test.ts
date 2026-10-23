import type { Pool } from 'drizzle-orm/minipg';
import { expect, test } from 'vitest';
import { preparePostgresDB } from '../../src/cli/connections';

test('minipg client: preparePostgresDB rejects a value that is not a minipg Pool', async () => {
	const client = { query: () => {} } as unknown as Pool;
	await expect(preparePostgresDB({ client })).rejects.toThrowError(/dbCredentials\.client is not a minipg Pool/);
});
