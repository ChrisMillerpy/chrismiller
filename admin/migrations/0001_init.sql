create table students (
  id integer primary key autoincrement,
  name text not null check (length(trim(name)) between 1 and 200),
  level text check (level in ('GCSE', 'A Level', 'A Level + Further', 'Admissions test', 'Other')),
  exam_board text check (length(exam_board) <= 50),
  student_email text check (length(student_email) <= 254),
  parent_name text check (length(parent_name) <= 200),
  parent_email text check (length(parent_email) <= 254),
  parent_phone text check (length(parent_phone) <= 40),
  rate_pence integer not null default 0 check (rate_pence >= 0),
  status text not null default 'active' check (status in ('active', 'paused', 'finished')),
  notes text check (length(notes) <= 10000),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create table lessons (
  id integer primary key autoincrement,
  student_id integer not null references students (id) on delete cascade,
  date text not null check (date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  time text check (time glob '[0-2][0-9]:[0-5][0-9]'),
  minutes integer not null default 60 check (minutes between 5 and 600),
  price_pence integer not null check (price_pence >= 0),
  covered text check (length(covered) <= 10000),
  homework text check (length(homework) <= 10000),
  notes text check (length(notes) <= 10000),
  paid_on text check (paid_on is null or paid_on glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index lessons_student_date on lessons (student_id, date desc);
create index lessons_date on lessons (date);
