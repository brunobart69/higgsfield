-- =====================================================================
-- JB RENT PRO — Migration 0007a: novas categorias (arquivo separado porque
-- valores novos de enum só podem ser usados depois do commit)
-- =====================================================================
alter type public.transaction_category add value if not exists 'repairs';
alter type public.transaction_category add value if not exists 'fines';
alter type public.transaction_category add value if not exists 'fine_recharge';
alter type public.transaction_category add value if not exists 'damage_recovery';

alter type public.document_category add value if not exists 'maintenance_invoice';
alter type public.document_category add value if not exists 'fine_notice';
alter type public.document_category add value if not exists 'accident_report';
