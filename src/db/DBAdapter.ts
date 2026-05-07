export interface QueryResult {
  rows:     Record<string, unknown>[];
  rowCount: number;
}

export interface DBAdapter {
  readonly name: string;
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  close(): Promise<void>;
}
