// Firebase(앱·Storage SDK)는 사진을 올릴 때만 불러온다.
export async function uploadLegacyHubPhoto(orderId: string, content: Blob): Promise<string> {
  const [{ getDownloadURL, ref, uploadBytes }, { getFirebaseStorage }] = await Promise.all([
    import('firebase/storage'),
    import('@/lib/firebase'),
  ]);
  const storage = await getFirebaseStorage();
  const storageRef = ref(storage, `deliveryPhotos/${orderId}_${Date.now()}.jpg`);
  await uploadBytes(storageRef, content, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}
