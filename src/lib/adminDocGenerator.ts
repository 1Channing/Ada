import { supabase } from './supabase';
import { generatePDFFromTemplate, DocumentData } from './templateEngine';

export async function generateAdminDocument(
  documentType: string,
  transactionId: string
): Promise<Blob> {
  const correlationId = `adminDocGen_${transactionId}_${Date.now()}`;
  console.log(`[ADMIN_DOC_GEN:${correlationId}] Starting document generation: template="${documentType}"`);

  const { data: transaction, error: txError } = await supabase
    .from('transactions_admin')
    .select(`
      *,
      vehicle:vehicles_admin!transactions_admin_vehicle_id_fkey(*),
      seller:contacts!transactions_admin_seller_contact_id_fkey(*),
      seller2:contacts!transactions_admin_seller_contact_id_2_fkey(*),
      buyer:contacts!transactions_admin_buyer_contact_id_fkey(*),
      buyer2:contacts!transactions_admin_buyer_contact_id_2_fkey(*)
    `)
    .eq('id', transactionId)
    .single();

  if (txError || !transaction) {
    const errorMessage = txError
      ? `Failed to load transaction data: ${txError.message}${txError.details ? ` (${txError.details})` : ''}${txError.code ? ` [${txError.code}]` : ''}`
      : 'Failed to load transaction data: No transaction found';
    console.error(`[ADMIN_DOC_GEN:${correlationId}] Transaction load error:`, txError);
    throw new Error(errorMessage);
  }

  console.log(`[ADMIN_DOC_GEN:${correlationId}] Transaction loaded: vehicle=${transaction.vehicle?.plate_number || 'N/A'}, seller=${transaction.seller?.company_name || transaction.seller?.last_name || 'N/A'}, buyer=${transaction.buyer?.company_name || transaction.buyer?.last_name || 'N/A'}`);

  const documentData: DocumentData = {
    vehicle: {
      plate_number: transaction.vehicle?.plate_number,
      vin: transaction.vehicle?.vin,
      brand: transaction.vehicle?.brand,
      model: transaction.vehicle?.model,
      commercial_name: transaction.vehicle?.commercial_name,
      type_variant_version: transaction.vehicle?.type_variant_version,
      national_type: transaction.vehicle?.national_type,
      first_registration_date: transaction.vehicle?.first_registration_date,
      mileage: transaction.vehicle?.mileage,
      registration_certificate_present: transaction.vehicle?.registration_certificate_present,
      registration_certificate_number: transaction.vehicle?.registration_certificate_number,
      known_defects: transaction.vehicle?.known_defects,
    },
    transaction: {
      transaction_type: transaction.transaction_type,
      transaction_date: transaction.transaction_date,
      transaction_time: transaction.transaction_time,
      transaction_price: transaction.transaction_price,
      pickup_location: transaction.pickup_location,
      pickup_contact: transaction.pickup_contact,
      pickup_datetime: transaction.pickup_datetime,
      destination: transaction.destination,
      transporter: transaction.transporter,
    },
    seller: transaction.seller ? {
      company_name: transaction.seller.company_name,
      first_name: transaction.seller.first_name,
      last_name: transaction.seller.last_name,
      birth_date: transaction.seller.birth_date,
      birth_place: transaction.seller.birth_place,
      address_line1: transaction.seller.address_line1,
      address_line2: transaction.seller.address_line2,
      postal_code: transaction.seller.postal_code,
      city: transaction.seller.city,
      country: transaction.seller.country,
      siren: transaction.seller.siren,
    } : undefined,
    seller2: transaction.seller2 ? {
      company_name: transaction.seller2.company_name,
      first_name: transaction.seller2.first_name,
      last_name: transaction.seller2.last_name,
      birth_date: transaction.seller2.birth_date,
      birth_place: transaction.seller2.birth_place,
      address_line1: transaction.seller2.address_line1,
      address_line2: transaction.seller2.address_line2,
      postal_code: transaction.seller2.postal_code,
      city: transaction.seller2.city,
      country: transaction.seller2.country,
      siren: transaction.seller2.siren,
    } : undefined,
    buyer: transaction.buyer ? {
      company_name: transaction.buyer.company_name,
      first_name: transaction.buyer.first_name,
      last_name: transaction.buyer.last_name,
      birth_date: transaction.buyer.birth_date,
      birth_place: transaction.buyer.birth_place,
      address_line1: transaction.buyer.address_line1,
      address_line2: transaction.buyer.address_line2,
      postal_code: transaction.buyer.postal_code,
      city: transaction.buyer.city,
      country: transaction.buyer.country,
      siren: transaction.buyer.siren,
    } : undefined,
    buyer2: transaction.buyer2 ? {
      company_name: transaction.buyer2.company_name,
      first_name: transaction.buyer2.first_name,
      last_name: transaction.buyer2.last_name,
      birth_date: transaction.buyer2.birth_date,
      birth_place: transaction.buyer2.birth_place,
      address_line1: transaction.buyer2.address_line1,
      address_line2: transaction.buyer2.address_line2,
      postal_code: transaction.buyer2.postal_code,
      city: transaction.buyer2.city,
      country: transaction.buyer2.country,
      siren: transaction.buyer2.siren,
    } : undefined,
  };

  console.log(`[ADMIN_DOC_GEN:${correlationId}] Calling template engine for "${documentType}"`);
  const pdfBytes = await generatePDFFromTemplate(documentType, documentData);
  const pdfSizeKB = (pdfBytes.length / 1024).toFixed(2);
  console.log(`[ADMIN_DOC_GEN:${correlationId}] PDF generated successfully: size=${pdfSizeKB}KB`);

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });

  try {
    const fileName = `${documentType
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")}_${Date.now()}.pdf`;
    const storagePath = `transactions/${transactionId}/${fileName}`;
    console.log(`[ADMIN_DOC_GEN:${correlationId}] Uploading to storage: path="${storagePath}"`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('admin-documents')
      .upload(storagePath, blob);

    if (uploadError) {
      const uploadErrorMessage = `Storage upload failed: ${uploadError.message}${uploadError.cause ? ` (${uploadError.cause})` : ''}`;
      console.error(`[ADMIN_DOC_GEN:${correlationId}]`, uploadErrorMessage, uploadError);
      throw new Error(uploadErrorMessage);
    }

    console.log(`[ADMIN_DOC_GEN:${correlationId}] Upload successful: storage_path="${uploadData.path}"`);

    const { data: urlData } = supabase.storage
      .from('admin-documents')
      .getPublicUrl(uploadData.path);

    console.log(`[ADMIN_DOC_GEN:${correlationId}] Saving to history: storage_path="${uploadData.path}", public_url="${urlData.publicUrl}"`);

    const { error: historyError } = await supabase.from('documents_admin_history').insert({
      transaction_id: transactionId,
      document_type: documentType,
      pdf_url: urlData.publicUrl,
      storage_path: uploadData.path,
    });

    if (historyError) {
      const historyErrorMessage = `History insert failed: ${historyError.message}${historyError.details ? ` (${historyError.details})` : ''}${historyError.code ? ` [${historyError.code}]` : ''}`;
      console.error(`[ADMIN_DOC_GEN:${correlationId}]`, historyErrorMessage, historyError);
      throw new Error(historyErrorMessage);
    }

    console.log(`[ADMIN_DOC_GEN:${correlationId}] Document saved to storage and history successfully`);
  } catch (error) {
    console.warn(`[ADMIN_DOC_GEN:${correlationId}] Upload/history failed but returning PDF blob:`, error);
  }

  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
