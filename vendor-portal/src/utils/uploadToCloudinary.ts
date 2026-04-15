export async function uploadToCloudinary(file: File): Promise<string> {
  const formData = new FormData();

  formData.append("file", file);
  formData.append("upload_preset", "vendcore_unsigned");

  const res = await fetch(
    "https://api.cloudinary.com/v1_1/ddvi2bnvq/image/upload",
    {
      method: "POST",
      body: formData,
    }
  );

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message || "Upload failed");
  }

  return data.secure_url;
}