import { File } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"

import { MAX_ATTACHMENT_BYTES, validateAttachment } from "./attachments"

/**
 * THE CAMERA AND THE PHOTO LIBRARY, INSIDE OVALBALL'S OWN RULES.
 *
 * TWO SOURCES, AND DELIBERATELY NOT A THIRD. There is no Files picker here, and that is the product
 * decision rather than an omission: a document in an Ovalball conversation comes from the club's own
 * library, which has an owner, a category and a revision, not from whatever happens to be on one
 * person's handset. `expo-document-picker` is not a dependency of this app, so the option cannot be
 * quietly restored by adding four lines to a menu.
 *
 * Both sources end at the same place: a name, a MIME type, a size and some bytes, checked against the
 * canonical attachment rules BEFORE anything is uploaded. iOS will happily hand back a 48-megapixel
 * HEIC; the platform accepts JPEG at two megabytes, and that is what is enforced.
 *
 * PERMISSION IS ASKED WHEN THE ACTION IS CHOSEN, never at launch. A camera prompt on first open is
 * how an app gets refused permanently by somebody who had not yet decided to take a photo.
 *
 * A PHONE PHOTO IS PREPARED, NOT JUST MEASURED -- and this is the part that has to be real work rather
 * than a comment. An iPhone photo is HEIC and four to six megabytes; the platform accepts JPEG at two.
 * Left alone, `Take Photo` would be a button that opened the camera and then refused the result, every
 * time. So the image is resized to 1600px on its long edge and re-encoded as JPEG, and if the result
 * is still over the limit the quality is stepped down and it is tried again. 1600px keeps a team sheet
 * legible and a pitch sign readable, which is what these photos are for. Re-encoding also drops the
 * EXIF block, so the location a photo was taken at does not travel with it into a club conversation.
 *
 * THE BYTES ARE READ THROUGH `expo-file-system`'s CURRENT API. `FileSystem.readAsStringAsync` is
 * deprecated in SDK 57 and THROWS AT RUNTIME from the package's main entry point -- it type-checks and
 * then fails on the device, which is the worst shape a defect can take. `new File(uri).arrayBuffer()`
 * is the supported route and needs no base64 round trip, so a two-megabyte attachment is not first
 * inflated to 2.7MB of string.
 */

export interface PickedFile {
  name: string
  mimeType: string
  sizeBytes: number
  uri: string
}

export type PickResult =
  | { ok: true; file: PickedFile }
  | { ok: false; message: string }
  | { cancelled: true }

export async function takePhoto(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) {
    return {
      ok: false,
      message: permission.canAskAgain
        ? "Ovalball needs camera access to take a photo."
        : "Camera access is turned off for Ovalball. You can switch it on in iPhone Settings.",
    }
  }
  return fromImagePicker(
    await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, exif: false })
  )
}

export async function choosePhoto(): Promise<PickResult> {
  // THE NARROWER PERMISSION ON PURPOSE. iOS lets somebody grant access to selected photos only, and
  // an app that demands the whole library to attach one picture is asking for more than it needs.
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    return {
      ok: false,
      message: permission.canAskAgain
        ? "Ovalball needs access to your photos to attach one."
        : "Photo access is turned off for Ovalball. You can switch it on in iPhone Settings.",
    }
  }
  return fromImagePicker(
    await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, exif: false })
  )
}

/** The bytes, read at send time rather than held in memory from the moment of choosing. */
export async function readFileBytes(uri: string): Promise<ArrayBuffer | null> {
  try {
    return await new File(uri).arrayBuffer()
  } catch {
    return null
  }
}

/**
 * A camera or library image, made attachable.
 *
 * Three attempts at falling quality rather than one. A single fixed quality either refuses a detailed
 * photo or ruins a simple one; stepping down only when the result is actually too large means most
 * photos keep the better encoding, and the ones that would have been refused still go.
 */
async function prepareImage(uri: string): Promise<{ uri: string; sizeBytes: number } | null> {
  for (const attempt of [
    { width: 1600, compress: 0.72 },
    { width: 1600, compress: 0.5 },
    { width: 1200, compress: 0.4 },
  ]) {
    try {
      const rendered = await ImageManipulator.manipulate(uri).resize({ width: attempt.width }).renderAsync()
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: attempt.compress })
      const sizeBytes = sizeOf(saved.uri)
      if (sizeBytes > 0 && sizeBytes <= MAX_ATTACHMENT_BYTES) return { uri: saved.uri, sizeBytes }
    } catch {
      return null
    }
  }
  return null
}

/** The size on disk, from the file itself rather than from whatever the picker claimed. */
function sizeOf(uri: string): number {
  try {
    return new File(uri).size ?? 0
  } catch {
    return 0
  }
}

async function fromImagePicker(result: ImagePicker.ImagePickerResult): Promise<PickResult> {
  if (result.canceled || !result.assets?.[0]) return { cancelled: true }
  const asset = result.assets[0]

  const prepared = await prepareImage(asset.uri)
  if (!prepared) {
    return {
      ok: false,
      message: "That photo couldn't be prepared for sending. Try another one, or attach it as a file.",
    }
  }

  // Always JPEG by this point, because that is what was just written -- not a guess at what the
  // camera produced.
  const file: PickedFile = {
    name: jpegName(asset.fileName),
    mimeType: "image/jpeg",
    sizeBytes: prepared.sizeBytes,
    uri: prepared.uri,
  }
  const refusal = validateAttachment(file)
  return refusal ? { ok: false, message: refusal } : { ok: true, file }
}

/**
 * The original name kept, the extension corrected.
 *
 * `IMG_4821.HEIC` is now a JPEG, and a filename that lies about its contents follows the attachment
 * into an export and an email. What somebody recognises is `IMG_4821`, so that part stays.
 */
function jpegName(original: string | null | undefined): string {
  const base = (original ?? "").replace(/\.[^./\\]+$/, "").trim()
  return `${base || `photo-${Date.now()}`}.jpg`
}
