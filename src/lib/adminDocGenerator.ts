import { supabase } from './supabase';
import { generatePDFFromTemplate, DocumentData } from './templateEngine';

export async function generateAdminDocument(
  documentType: string,
  transactionId: string
): Promise<Blob> {
  console.log('[ADMIN_DOC_GEN] Starting document generation:', documentType);

  const { data: transaction, error: txError } = await supabase
    .from('transactions_admin')
    .select(`
      *,
      vehicle:vehicles_admin(*),
      seller:seller_contact_id(*),
      seller2:seller_contact_id_2(*),
      buyer:buyer_contact_id(*),
      buyer2:buyer_contact_id_2(*)
    `)
    .eq('id', transactionId)
    .single();

  if (txError || !transaction) {
    throw new Error('Failed to load transaction data');
  }

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
  };

  const pdfBytes = await generatePDFFromTemplate(documentType, documentData);
  console.log('[ADMIN_DOC_GEN] PDF generated successfully');

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });

  const fileName = `${documentType.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('admin-documents')
    .upload(`transactions/${transactionId}/${fileName}`, blob);

  if (uploadError) {
    console.error('[ADMIN_DOC_GEN] Upload error:', uploadError);
    throw new Error('Failed to upload document');
  }

  const { data: urlData } = supabase.storage
    .from('admin-documents')
    .getPublicUrl(uploadData.path);

  await supabase.from('documents_admin_history').insert({
    transaction_id: transactionId,
    document_type: documentType,
    pdf_url: urlData.publicUrl,
  });

  console.log('[ADMIN_DOC_GEN] Document saved to history');

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
