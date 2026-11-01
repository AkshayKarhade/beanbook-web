-- MVP-1: optional customer email and auditable, idempotent bill-email dispatch.
-- No historical customer or order values are changed.
alter table public.customers
 add column if not exists email text;

alter table public.customers
 add constraint beanbook_customer_email_format_check
 check (
   email is null
   or (length(email) between 5 and 254 and email = lower(btrim(email))
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
 );

create table public.beanbook_bill_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 brand_id uuid not null references public.brands(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade,
 customer_id uuid not null references public.customers(id),
 request_id uuid not null,
 recipient_email text not null,
 order_amount numeric(12,2) not null,
 status text not null default 'sending'
   check (status in ('sending','sent','failed','unknown')),
 provider_email_id text,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 error_code text,
 unique (brand_id, request_id)
);
create index beanbook_bill_email_deliveries_order_idx
 on public.beanbook_bill_email_deliveries (brand_id,order_id,created_at desc);
alter table public.beanbook_bill_email_deliveries enable row level security;
revoke all on public.beanbook_bill_email_deliveries from public,anon,authenticated;
grant select,insert,update on public.beanbook_bill_email_deliveries to service_role;

-- Only server-side service-role callers can finalize an email accepted by the provider.
-- Email and sent-state commit together; no 'sent' result if customer profile was not updated.
create function public.beanbook_mark_bill_email_sent(
 p_delivery_id uuid,
 p_provider_id text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_record public.beanbook_bill_email_deliveries%rowtype;
begin
 select * into v_record from public.beanbook_bill_email_deliveries
  where id=p_delivery_id for update;
 if not found then raise exception 'Delivery record unavailable' using errcode='22023'; end if;
 if v_record.status='sent' then return true; end if;
 if v_record.status<>'sending' then raise exception 'Delivery is not pending' using errcode='22023'; end if;
 update public.customers set email=v_record.recipient_email, updated_at=now()
  where id=v_record.customer_id and brand_id=v_record.brand_id;
 if not found then raise exception 'Customer unavailable for email save' using errcode='22023'; end if;
 update public.beanbook_bill_email_deliveries
  set status='sent',provider_email_id=p_provider_id,sent_at=now(),error_code=null
  where id=v_record.id;
 return true;
end;
$$;
revoke all on function public.beanbook_mark_bill_email_sent(uuid,text) from public,anon,authenticated;
grant execute on function public.beanbook_mark_bill_email_sent(uuid,text) to service_role;
