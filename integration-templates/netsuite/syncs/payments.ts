import type { NangoSync, NetsuitePayment, ProxyConfiguration } from '../../models';
import type { NS_Payment, NSAPI_GetResponse, NSAPI_GetResponses, NSAPI_Links } from '../types';
import { paginate } from '../helpers/pagination.js';

const retries = 3;

export default async function fetchData(nango: NangoSync): Promise<void> {
    const proxyConfig: ProxyConfiguration = {
        endpoint: '/customerpayment',
        retries
    };
    for await (const payments of paginate<{ id: string }>({ nango, proxyConfig })) {
        await nango.log('Listed payments', { total: payments.length });

        const mappedPayments: NetsuitePayment[] = [];
        for (const paymentLink of payments) {
            const payment: NSAPI_GetResponse<NS_Payment> = await nango.get({
                endpoint: `/customerpayment/${paymentLink.id}`,
                retries
            });
            if (!payment.data) {
                await nango.log('Payment not found', { id: paymentLink.id });
                continue;
            }
            const apply: NSAPI_GetResponses<any> = await nango.get({
                endpoint: `/customerpayment/${paymentLink.id}/apply`,
                retries
            });
            const applyTo = apply.data.items.flatMap((applyLink: NSAPI_Links) => {
                const doc = applyLink.links?.find((link) => link.rel === 'self')?.href?.match(/\/apply\/doc=(\d+)/)?.[1];
                return doc ? [doc] : [];
            });
            const mappedPayment: NetsuitePayment = {
                id: payment.data.id,
                createdAt: payment.data.tranDate || null,
                customerId: payment.data.customer?.id || null,
                amount: payment.data.payment ? Number(payment.data.payment) : 0,
                currency: payment.data.currency?.refName || null,
                paymentReference: payment.data.tranId || null,
                status: payment.data.status?.id || null,
                applyTo
            };
            if (payment.data.memo) {
                mappedPayment.description = payment.data.memo;
            }
            mappedPayments.push(mappedPayment);
        }

        await nango.batchSave<NetsuitePayment>(mappedPayments, 'NetsuitePayment');
    }
}
