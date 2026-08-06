CREATE POLICY "wa avatars readable by authenticated"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'whatsapp-avatars');