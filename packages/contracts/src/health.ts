/** Public transport contract; contains no infrastructure or private configuration. */
export type HealthResponse =
  | {
      status: 'ok';
      api: 'up';
      database: 'up';
      checkedAt: string;
    }
  | {
      status: 'error';
      api: 'up';
      database: 'down';
      checkedAt: string;
    };
