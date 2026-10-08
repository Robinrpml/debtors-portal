-- Functions get EXECUTE for PUBLIC by default; tighten so anon can't call any of them,
-- and nobody can call the trigger function over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_active_user() from public, anon;
revoke execute on function public.is_manager() from public, anon;
revoke execute on function public.my_brand_access() from public, anon;
revoke execute on function public.can_see_brand(text) from public, anon;
-- Policies evaluate these as the signed-in user, so authenticated keeps EXECUTE.
-- They only reveal the caller's own role / brand access.
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.my_brand_access() to authenticated;
grant execute on function public.can_see_brand(text) to authenticated;
