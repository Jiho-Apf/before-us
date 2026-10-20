-- 상대 사진은 partner-photo 함수(5분짜리 주소)로만 연다. 저장소 정책에는 본인·운영진만 남긴다.
drop policy "사진: 본인·운영진·열람 기간의 상대만 보기" on storage.objects;
create policy "사진: 본인·운영진만 보기" on storage.objects for select to authenticated
  using (bucket_id = 'application-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin(array['owner','operator','counselor'])));
