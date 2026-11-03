-- =====================================================================
-- JB RENT PRO — Migration 0008a: categorias não operacionais
-- (arquivo separado: valores novos de enum só podem ser usados após o commit)
-- =====================================================================
alter type public.transaction_category add value if not exists 'vehicle_sale';      -- receita: venda de veículo (patrimônio)
alter type public.transaction_category add value if not exists 'loan_received';     -- entrada: financiamento/empréstimo recebido
alter type public.transaction_category add value if not exists 'owner_contribution';-- entrada: aporte de sócios
alter type public.transaction_category add value if not exists 'loan_repayment';    -- saída: parcela de financiamento/empréstimo
alter type public.transaction_category add value if not exists 'owner_withdrawal';  -- saída: retirada de sócios
