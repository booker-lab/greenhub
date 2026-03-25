import { Injectable, Inject } from '@nestjs/common';
import * as admin from 'firebase-admin';

@Injectable()
export class FirestoreService {
  readonly db: admin.firestore.Firestore;

  constructor(@Inject('FIREBASE_APP') private readonly app: admin.app.App) {
    this.db = this.app.firestore();
  }

  collection(path: string) {
    return this.db.collection(path);
  }

  doc(path: string) {
    return this.db.doc(path);
  }

  runTransaction<T>(
    fn: (t: admin.firestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.db.runTransaction(fn);
  }

  get FieldValue() {
    return admin.firestore.FieldValue;
  }

  get Timestamp() {
    return admin.firestore.Timestamp;
  }
}
