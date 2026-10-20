// Every D1 migration, in order. The Registry applies them on first use.
import S1 from '../../../d1/migrations/0001_sessions.sql';
import S2 from '../../../d1/migrations/0002_names_artifacts.sql';
import S3 from '../../../d1/migrations/0003_subagents.sql';
import S4 from '../../../d1/migrations/0004_money.sql';

export const SCHEMA = [S1, S2, S3, S4];
