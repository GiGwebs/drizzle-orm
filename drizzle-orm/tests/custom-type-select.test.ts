import { expect, test } from 'vitest';

import type { AnyColumn } from '~/column';
import { drizzle as gelDrizzle } from '~/gel';
import { drizzle as mysqlDrizzle } from '~/mysql2';
import { drizzle as pgDrizzle } from '~/node-postgres';
import { createTableRelationsHelpers, extractTablesRelationalConfig, relations } from '~/relations';
import { drizzle as singlestoreDrizzle } from '~/singlestore';
import { SQL, sql } from '~/sql/sql';
import { drizzle as sqliteDrizzle } from '~/sqlite-proxy';
import { mapResultRow, orderSelectedFields } from '~/utils';

import { customType as gelCustomType, gelTable, integer as gelInt } from '~/gel-core';
import { customType as mysqlCustomType, int as mysqlInt, mysqlTable, serial as mysqlSerial } from '~/mysql-core';
import { customType as pgCustomType, integer as pgInteger, pgTable, serial as pgSerial } from '~/pg-core';
import {
	customType as singlestoreCustomType,
	int as singlestoreInt,
	serial as singlestoreSerial,
	singlestoreTable,
} from '~/singlestore-core';
import { SingleStoreDialect } from '~/singlestore-core';
import { customType as sqliteCustomType, integer as sqliteInt, sqliteTable } from '~/sqlite-core';

const pgPoint = pgCustomType<{ data: { x: number; y: number }; driverData: string }>({
	dataType: () => 'point',
	toDriver: (value) => `(${value.x},${value.y})`,
	fromDriver: (value) => {
		const [x, y] = value.slice(1, -1).split(',');
		return { x: Number(x), y: Number(y) };
	},
	selectFromDb: (field) => sql`${field}::text`,
});

const pgPlain = pgCustomType<{ data: { x: number; y: number }; driverData: string }>({
	dataType: () => 'point',
	toDriver: (value) => `(${value.x},${value.y})`,
	fromDriver: (value) => {
		const [x, y] = value.slice(1, -1).split(',');
		return { x: Number(x), y: Number(y) };
	},
});

const pgUsers = pgTable('users', {
	id: pgSerial('id').primaryKey(),
	geo: pgPoint('geo'),
	plain: pgPlain('plain'),
});

const pgPosts = pgTable('posts', {
	id: pgSerial('id').primaryKey(),
	authorId: pgInteger('author_id'),
	geo: pgPoint('geo'),
});

const pgUsersRelations = relations(pgUsers, ({ many }) => ({ posts: many(pgPosts) }));
const pgPostsRelations = relations(pgPosts, ({ one }) => ({
	author: one(pgUsers, { fields: [pgPosts.authorId], references: [pgUsers.id] }),
}));

const pgDb = pgDrizzle.mock({
	schema: { users: pgUsers, posts: pgPosts, pgUsersRelations, pgPostsRelations },
});

test('pg: select wraps custom column with selectFromDb', () => {
	const query = pgDb.select().from(pgUsers).toSQL();
	expect(query.sql).toBe(
		'select "id", "geo"::text as "geo", "plain" from "users"',
	);
});

test('pg: select wraps qualified custom column in joins', () => {
	const query = pgDb
		.select({ id: pgUsers.id, geo: pgUsers.geo, postId: pgPosts.id })
		.from(pgUsers)
		.leftJoin(pgPosts, sql`${pgPosts.authorId} = ${pgUsers.id}`)
		.toSQL();
	expect(query.sql).toBe(
		'select "users"."id", "users"."geo"::text as "geo", "posts"."id" from "users" left join "posts" on "posts"."author_id" = "users"."id"',
	);
});

test('pg: insert returning wraps custom column', () => {
	const query = pgDb
		.insert(pgUsers)
		.values({ geo: { x: 1, y: 2 } })
		.returning()
		.toSQL();
	expect(query.sql).toContain('returning "id", "geo"::text as "geo", "plain"');
});

test('pg: update returning wraps custom column', () => {
	const query = pgDb
		.update(pgUsers)
		.set({ geo: { x: 3, y: 4 } })
		.returning()
		.toSQL();
	expect(query.sql).toContain('returning "id", "geo"::text as "geo", "plain"');
});

test('pg: relational query wraps custom column', () => {
	const query = pgDb.query.users.findMany().toSQL();
	expect(query.sql).toBe('select "id", "geo"::text as "geo", "plain" from "users" "users"');
});

test('pg: nested relational query wraps custom column in json_build_array', () => {
	const query = pgDb.query.users.findMany({ with: { posts: true } }).toSQL();
	expect(query.sql).toContain('"users"."geo"::text as "geo"');
	expect(query.sql).toContain(
		'json_build_array("users_posts"."id", "users_posts"."author_id", "users_posts"."geo"::text)',
	);
});

test('pg: fromDriver still decodes the wrapped result', () => {
	const fieldsList = orderSelectedFields<AnyColumn>({ geo: pgUsers.geo });
	const row = mapResultRow<{ geo: { x: number; y: number } }>(fieldsList, ['(1,2)'], undefined);
	expect(row.geo).toEqual({ x: 1, y: 2 });
});

const mysqlPoint = mysqlCustomType<{ data: string }>({
	dataType: () => 'geometry',
	fromDriver: (value) => value,
	selectFromDb: (field) => sql`ST_AsText(${field})`,
});

const mysqlPlain = mysqlCustomType<{ data: string }>({
	dataType: () => 'geometry',
	fromDriver: (value) => value,
});

const mysqlUsers = mysqlTable('users', {
	id: mysqlSerial('id').primaryKey(),
	geo: mysqlPoint('geo'),
	plain: mysqlPlain('plain'),
});

const mysqlPosts = mysqlTable('posts', {
	id: mysqlSerial('id').primaryKey(),
	authorId: mysqlInt('author_id'),
	geo: mysqlPoint('geo'),
});

const mysqlUsersRelations = relations(mysqlUsers, ({ many }) => ({ posts: many(mysqlPosts) }));
const mysqlPostsRelations = relations(mysqlPosts, ({ one }) => ({
	author: one(mysqlUsers, { fields: [mysqlPosts.authorId], references: [mysqlUsers.id] }),
}));

const mysqlDb = mysqlDrizzle.mock({
	mode: 'default',
	schema: { users: mysqlUsers, posts: mysqlPosts, mysqlUsersRelations, mysqlPostsRelations },
});

const mysqlDbNoLateral = mysqlDrizzle.mock({
	mode: 'planetscale',
	schema: { users: mysqlUsers, posts: mysqlPosts, mysqlUsersRelations, mysqlPostsRelations },
});

test('mysql: select wraps custom column with selectFromDb', () => {
	const query = mysqlDb.select().from(mysqlUsers).toSQL();
	expect(query.sql).toBe('select `id`, ST_AsText(`geo`) as `geo`, `plain` from `users`');
});

test('mysql: nested relational query wraps custom column in json_array', () => {
	const query = mysqlDb.query.users.findMany({ with: { posts: true } }).toSQL();
	expect(query.sql).toContain('ST_AsText(`users`.`geo`) as `geo`');
	expect(query.sql).toContain(
		'json_array(`users_posts`.`id`, `users_posts`.`author_id`, ST_AsText(`users_posts`.`geo`))',
	);
});

test('mysql: non-lateral nested relational query wraps custom column in json_array', () => {
	const query = mysqlDbNoLateral.query.users.findMany({ with: { posts: true } }).toSQL();
	expect(query.sql).toContain('json_array(`id`, `author_id`, ST_AsText(`geo`))');
});

const sqlitePoint = sqliteCustomType<{ data: string }>({
	dataType: () => 'blob',
	fromDriver: (value) => value,
	selectFromDb: (field) => sql`hex(${field})`,
});

const sqliteUsers = sqliteTable('users', {
	id: sqliteInt('id').primaryKey(),
	geo: sqlitePoint('geo'),
});

const sqlitePosts = sqliteTable('posts', {
	id: sqliteInt('id').primaryKey(),
	authorId: sqliteInt('author_id'),
	geo: sqlitePoint('geo'),
});

const sqliteUsersRelations = relations(sqliteUsers, ({ many }) => ({ posts: many(sqlitePosts) }));
const sqlitePostsRelations = relations(sqlitePosts, ({ one }) => ({
	author: one(sqliteUsers, { fields: [sqlitePosts.authorId], references: [sqliteUsers.id] }),
}));

const sqliteDb = sqliteDrizzle(async () => ({ rows: [] }), {
	schema: { users: sqliteUsers, posts: sqlitePosts, sqliteUsersRelations, sqlitePostsRelations },
});

test('sqlite: select wraps custom column with selectFromDb', () => {
	const query = sqliteDb.select().from(sqliteUsers).toSQL();
	expect(query.sql).toBe('select "id", hex("geo") as "geo" from "users"');
});

test('sqlite: nested relational query wraps custom column in json_array', () => {
	const query = sqliteDb.query.users.findMany({ with: { posts: true } }).toSQL();
	expect(query.sql).toContain('select "id", hex("geo") as "geo"');
	expect(query.sql).toContain('json_array("id", "author_id", hex("geo"))');
});

const singlestorePoint = singlestoreCustomType<{ data: string }>({
	dataType: () => 'geographypoint',
	fromDriver: (value) => value,
	selectFromDb: (field) => sql`ST_AsText(${field})`,
});

const singlestoreUsers = singlestoreTable('users', {
	id: singlestoreSerial('id').primaryKey(),
	geo: singlestorePoint('geo'),
});

const singlestorePosts = singlestoreTable('posts', {
	id: singlestoreSerial('id').primaryKey(),
	authorId: singlestoreInt('author_id'),
	geo: singlestorePoint('geo'),
});

const singlestoreUsersRelations = relations(singlestoreUsers, ({ many }) => ({
	posts: many(singlestorePosts),
}));
const singlestorePostsRelations = relations(singlestorePosts, ({ one }) => ({
	author: one(singlestoreUsers, {
		fields: [singlestorePosts.authorId],
		references: [singlestoreUsers.id],
	}),
}));

const singlestoreDb = singlestoreDrizzle.mock({
	schema: {
		users: singlestoreUsers,
		posts: singlestorePosts,
		singlestoreUsersRelations,
		singlestorePostsRelations,
	},
});

test('singlestore: select wraps custom column with selectFromDb', () => {
	const query = singlestoreDb.select().from(singlestoreUsers).toSQL();
	expect(query.sql).toBe('select `id`, ST_AsText(`geo`) as `geo` from `users`');
});

test('singlestore: nested relational query wraps custom column in JSON_TO_ARRAY', () => {
	const schema = {
		users: singlestoreUsers,
		posts: singlestorePosts,
		singlestoreUsersRelations,
		singlestorePostsRelations,
	};
	const { tables, tableNamesMap } = extractTablesRelationalConfig(
		schema,
		createTableRelationsHelpers,
	);
	const dialect = new SingleStoreDialect();
	const query = dialect.buildRelationalQuery({
		fullSchema: schema,
		schema: tables,
		tableNamesMap,
		table: singlestoreUsers,
		tableConfig: tables['users']!,
		queryConfig: { with: { posts: true } },
		tableAlias: 'users',
	});
	const { sql: querySql } = dialect.sqlToQuery(query.sql as SQL);
	expect(querySql).toContain('ST_AsText(`users`.`geo`) as `geo`');
	expect(querySql).toContain(
		'JSON_TO_ARRAY(`users_posts`.`id`, `users_posts`.`author_id`, ST_AsText(`users_posts`.`geo`))',
	);
});

const gelPoint = gelCustomType<{ data: string }>({
	dataType: () => 'point',
	fromDriver: (value) => value,
	selectFromDb: (field) => sql`(${field})::text`,
});

const gelUsers = gelTable('users', {
	id: gelInt('id').primaryKey(),
	geo: gelPoint('geo'),
});

const gelPosts = gelTable('posts', {
	id: gelInt('id').primaryKey(),
	authorId: gelInt('author_id'),
	geo: gelPoint('geo'),
});

const gelUsersRelations = relations(gelUsers, ({ many }) => ({ posts: many(gelPosts) }));
const gelPostsRelations = relations(gelPosts, ({ one }) => ({
	author: one(gelUsers, { fields: [gelPosts.authorId], references: [gelUsers.id] }),
}));

const gelDb = gelDrizzle.mock({
	schema: { users: gelUsers, posts: gelPosts, gelUsersRelations, gelPostsRelations },
});

test('gel: select wraps custom column with selectFromDb', () => {
	const query = gelDb.select().from(gelUsers).toSQL();
	expect(query.sql).toBe('select "users"."id", ("users"."geo")::text as "geo" from "users"');
});

test('gel: nested relational query wraps custom column in json_build_array', () => {
	const query = gelDb.query.users.findMany({ with: { posts: true } }).toSQL();
	expect(query.sql).toContain('("users"."geo")::text as "geo"');
	expect(query.sql).toContain(
		'json_build_array("users_posts"."id", "users_posts"."author_id", ("users_posts"."geo")::text)',
	);
});
