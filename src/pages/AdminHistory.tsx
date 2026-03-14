import { useState, useEffect } from 'react';
import { Download, FileText, Search, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

type DocumentHistoryItem = {
  id: string;
  created_at: string;
  document_type: string;
  pdf_url: string;
  transaction: {
    transaction_date: string;
    vehicle: {
      plate_number: string;
      brand: string;
      model: string;
    };
    seller_contact: {
      company_name?: string;
      first_name?: string;
      last_name?: string;
    } | null;
    buyer_contact: {
      company_name?: string;
      first_name?: string;
      last_name?: string;
    } | null;
  };
};

export function AdminHistory() {
  const [documents, setDocuments] = useState<DocumentHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchDocType, setSearchDocType] = useState('');
  const [searchPlate, setSearchPlate] = useState('');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    console.log('[ADMIN_HISTORY] Loading document history');
    setLoading(true);
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('documents_admin_history')
        .select(`
          id,
          created_at,
          document_type,
          pdf_url,
          transaction_id,
          transactions_admin!inner (
            transaction_date,
            vehicles_admin!inner (
              plate_number,
              brand,
              model
            ),
            seller_contact:contacts!transactions_admin_seller_contact_id_fkey (
              company_name,
              first_name,
              last_name
            ),
            buyer_contact:contacts!transactions_admin_buyer_contact_id_fkey (
              company_name,
              first_name,
              last_name
            )
          )
        `)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedData = data?.map((doc: any) => ({
        id: doc.id,
        created_at: doc.created_at,
        document_type: doc.document_type,
        pdf_url: doc.pdf_url,
        transaction: {
          transaction_date: doc.transactions_admin.transaction_date,
          vehicle: {
            plate_number: doc.transactions_admin.vehicles_admin.plate_number,
            brand: doc.transactions_admin.vehicles_admin.brand,
            model: doc.transactions_admin.vehicles_admin.model,
          },
          seller_contact: doc.transactions_admin.seller_contact,
          buyer_contact: doc.transactions_admin.buyer_contact,
        },
      })) || [];

      console.log(`[ADMIN_HISTORY] Loaded ${formattedData.length} document history rows`);
      setDocuments(formattedData);
    } catch (error) {
      console.error('[ADMIN_HISTORY] Error loading documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const matchesDocType = !searchDocType ||
      doc.document_type.toLowerCase().includes(searchDocType.toLowerCase());

    const matchesPlate = !searchPlate ||
      doc.transaction.vehicle.plate_number?.toLowerCase().includes(searchPlate.toLowerCase());

    return matchesDocType && matchesPlate;
  });

  const formatContactName = (contact: { company_name?: string; first_name?: string; last_name?: string } | null) => {
    if (!contact) return '—';
    if (contact.company_name) return contact.company_name;
    if (contact.first_name || contact.last_name) {
      return `${contact.first_name || ''} ${contact.last_name || ''}`.trim();
    }
    return '—';
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Document History</h1>
          <p className="text-zinc-400 text-sm mt-1">Last 30 days of generated documents</p>
        </div>

        <button
          onClick={() => window.location.pathname = '/admin'}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors text-sm font-medium"
        >
          Back to Administrative
        </button>
      </div>

      <div className="mb-6 bg-zinc-900 border border-zinc-800 rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <Search size={20} className="text-zinc-400" />
          <h3 className="font-medium text-zinc-300">Search Documents</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Document Type</label>
            <div className="relative">
              <input
                type="text"
                value={searchDocType}
                onChange={(e) => setSearchDocType(e.target.value)}
                placeholder="e.g. Certificat, Bon d'achat..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 pr-8"
              />
              {searchDocType && (
                <button
                  onClick={() => setSearchDocType('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Vehicle Plate</label>
            <div className="relative">
              <input
                type="text"
                value={searchPlate}
                onChange={(e) => setSearchPlate(e.target.value)}
                placeholder="e.g. AB-123-CD"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-blue-500 pr-8"
              />
              {searchPlate && (
                <button
                  onClick={() => setSearchPlate('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
        {(searchDocType || searchPlate) && (
          <div className="mt-3 text-sm text-zinc-400">
            Showing {filteredDocuments.length} of {documents.length} documents
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-zinc-400">Loading documents...</div>
      ) : documents.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <FileText size={48} className="mx-auto mb-4 text-zinc-600" />
          <p className="text-zinc-400">No documents found in the last 30 days</p>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-12 text-center">
          <Search size={48} className="mx-auto mb-4 text-zinc-600" />
          <p className="text-zinc-400">No documents match your search criteria</p>
          <button
            onClick={() => {
              setSearchDocType('');
              setSearchPlate('');
            }}
            className="mt-4 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-zinc-800 border-b border-zinc-700">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Document Type</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Vehicle Plate</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Vehicle</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Transaction Date</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Seller</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Buyer</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-zinc-300">Created</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-zinc-300">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredDocuments.map((doc) => (
                  <tr key={doc.id} className="hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-zinc-800 rounded text-xs font-medium">
                        {doc.document_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">
                      {doc.transaction.vehicle.plate_number || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {doc.transaction.vehicle.brand} {doc.transaction.vehicle.model}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatDate(doc.transaction.transaction_date)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatContactName(doc.transaction.seller_contact)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatContactName(doc.transaction.buyer_contact)}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-400">
                      {formatDate(doc.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={doc.pdf_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded transition-colors text-sm font-medium"
                      >
                        <Download size={14} />
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 text-sm text-zinc-500 text-center">
        Documents are automatically deleted after 30 days
      </div>
    </div>
  );
}
