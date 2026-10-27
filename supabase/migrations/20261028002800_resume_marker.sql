-- 새 소개를 다시 받기 시작한 때(쉬기를 푼 때)를 기록한다.
-- 회원 화면은 ‘새 소개를 기다린 날’을 쉰 기간을 빼고 이때부터 센다.
-- 회원 스스로·운영진·자동 쉬기 어느 쪽이 풀어도 같은 자리에서 기록되도록 트리거로 둔다.
alter table public.profiles add column if not exists resumed_at timestamptz;

create or replace function public.mark_resumed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.paused_at is not null and new.paused_at is null then
    new.resumed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists profiles_mark_resumed on public.profiles;
create trigger profiles_mark_resumed before update of paused_at on public.profiles
  for each row execute function public.mark_resumed();
