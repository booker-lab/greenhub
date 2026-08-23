import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';

export async function uploadLegacyHubPhoto(orderId: string, content: Blob): Promise<string> {
  const storageRef = ref(storage, `deliveryPhotos/${orderId}_${Date.now()}.jpg`);
  await uploadBytes(storageRef, content, { contentType: 'image/jpeg' });
  return getDownloadURL(storageRef);
}
