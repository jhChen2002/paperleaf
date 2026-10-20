import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const authUser = sqliteTable('auth_user', {
  id: text('id').primaryKey(), name: text('name').notNull(), email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', {mode:'boolean'}).notNull().default(false), image: text('image'),
  createdAt: integer('createdAt', {mode:'timestamp_ms'}).notNull(), updatedAt: integer('updatedAt', {mode:'timestamp_ms'}).notNull(),
});
export const authSession = sqliteTable('auth_session', {
  id:text('id').primaryKey(), token:text('token').notNull().unique(), userId:text('userId').notNull().references(()=>authUser.id,{onDelete:'cascade'}),
  expiresAt:integer('expiresAt',{mode:'timestamp_ms'}).notNull(), createdAt:integer('createdAt',{mode:'timestamp_ms'}).notNull(), updatedAt:integer('updatedAt',{mode:'timestamp_ms'}).notNull(),
  ipAddress:text('ipAddress'), userAgent:text('userAgent'),
}, t=>[index('auth_session_user_idx').on(t.userId)]);
export const authAccount = sqliteTable('auth_account', {
  id:text('id').primaryKey(), accountId:text('accountId').notNull(), providerId:text('providerId').notNull(), userId:text('userId').notNull().references(()=>authUser.id,{onDelete:'cascade'}),
  accessToken:text('accessToken'), refreshToken:text('refreshToken'), idToken:text('idToken'), scope:text('scope'), password:text('password'),
  accessTokenExpiresAt:integer('accessTokenExpiresAt',{mode:'timestamp_ms'}), refreshTokenExpiresAt:integer('refreshTokenExpiresAt',{mode:'timestamp_ms'}),
  createdAt:integer('createdAt',{mode:'timestamp_ms'}).notNull(), updatedAt:integer('updatedAt',{mode:'timestamp_ms'}).notNull(),
}, t=>[index('auth_account_user_idx').on(t.userId),uniqueIndex('auth_account_provider_idx').on(t.providerId,t.accountId)]);
export const authVerification = sqliteTable('auth_verification', {
  id:text('id').primaryKey(), identifier:text('identifier').notNull(), value:text('value').notNull(),
  expiresAt:integer('expiresAt',{mode:'timestamp_ms'}).notNull(), createdAt:integer('createdAt',{mode:'timestamp_ms'}).notNull(), updatedAt:integer('updatedAt',{mode:'timestamp_ms'}).notNull(),
},t=>[index('auth_verification_identifier_idx').on(t.identifier)]);
export const authRateLimit = sqliteTable('auth_rate_limit', {
  id:text('id').primaryKey(), key:text('key').notNull().unique(), count:integer('count').notNull(),lastRequest:integer('lastRequest').notNull(),
});
export const authRecovery = sqliteTable('auth_recovery', {
  userId:text('user_id').primaryKey().references(()=>authUser.id,{onDelete:'cascade'}),codeHash:text('code_hash').notNull(),
});
export const authLibraryLink = sqliteTable('auth_library_link', {
  userId:text('user_id').primaryKey().references(()=>authUser.id,{onDelete:'cascade'}),legacyUserId:text('legacy_user_id').notNull().unique(),
});
export const authThrottle = sqliteTable('auth_throttle', {
  key:text('key').primaryKey(),count:integer('count').notNull(),expires:integer('expires').notNull(),
});

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6b8071"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("folders_user_idx").on(table.userId)]);

export const papers = sqliteTable("papers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  authors: text("authors").notNull().default(""),
  year: integer("year"),
  venue: text("venue").notNull().default(""),
  doi: text("doi").notNull().default(""),
  abstract: text("abstract").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
  status: text("status").notNull().default("unread"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  pageCount: integer("page_count").notNull().default(0),
  currentPage: integer("current_page").notNull().default(1),
  fileName: text("file_name"),
  fileSize: integer("file_size").notNull().default(0),
  fileKey: text("file_key"),
  fileHash: text("file_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [
  index("papers_user_updated_idx").on(table.userId, table.updatedAt),
  uniqueIndex("papers_user_hash_idx").on(table.userId, table.fileHash),
]);

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  paperId: text("paper_id").notNull().references(() => papers.id, { onDelete: "cascade" }),
  quote: text("quote").notNull().default(""),
  content: text("content").notNull().default(""),
  page: integer("page"),
  color: text("color").notNull().default("#f2d774"),
  tags: text("tags").notNull().default("[]"),
  rects: text("rects").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
}, (table) => [index("notes_user_paper_idx").on(table.userId, table.paperId)]);
