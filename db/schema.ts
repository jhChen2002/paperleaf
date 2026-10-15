import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
