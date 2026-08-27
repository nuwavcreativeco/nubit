-- The reels bucket said 500MB while the project's plan caps every upload at
-- 50MB, and the global cap wins. The app therefore advertised 500MB, accepted
-- a real reel, spent minutes uploading it, and got a 413 at the very end —
-- which is indistinguishable from "uploads are broken".
--
-- Match the bucket to the plan so the client-side guard refuses instantly and
-- honestly. On Pro this can go up; raise all three together (this value, the
-- project's Storage global setting, and NEXT_PUBLIC_MAX_UPLOAD_MB).
update storage.buckets
   set file_size_limit = 52428800  -- 50 MB, the Free plan ceiling
 where id in ('reels', 'avatars')
   and (file_size_limit is null or file_size_limit > 52428800);
