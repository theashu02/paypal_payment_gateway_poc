import { useEffect, useMemo, useState } from 'react';
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

const PLANS = [
  {
    id: 'startup',
    name: 'Startup Plan',
    badge: 'Most Popular',
    meta: 'Billed Annually',
    pricing: { yearly: 39, monthly: 49 },
    credits: [
      '2400 AI Planning Credits per Year',
      '12000 Email Credits per Year',
    ],
  },
  {
    id: 'scaleup',
    name: 'Scaleup Plan',
    pricing: { yearly: 199, monthly: 229 },
    meta: 'Billed Annually',
    credits: [
      '12000 AI Planning Credits per Year',
      '84000 Email Credits per Year',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise Plan',
    contactOnly: true,
    pricing: { yearly: 0, monthly: 0 },
    credits: ['Unlimited AI Planning Credits', 'Unlimited Email Credits'],
  },
];

const BILLING_LABELS = {
  yearly: 'Yearly',
  monthly: 'Monthly',
};

const STATUS_STYLES = {
  success: 'border-green-200 bg-green-50 text-green-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  loading: 'border-blue-200 bg-blue-50 text-blue-700',
  idle: 'border-slate-200 bg-slate-50 text-slate-600',
};

function App() {
  const [billingPeriod, setBillingPeriod] = useState('yearly');
  const [currency, setCurrency] = useState('USD');
  const [emailTopUp, setEmailTopUp] = useState('0');
  const [planningTopUp, setPlanningTopUp] = useState('0');
  const [gstNumber, setGstNumber] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState({ type: 'idle', message: '' });
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGateway, setSelectedGateway] = useState(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/config`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.message || 'Unable to load PayPal config');
        }
        setConfig(data);
        setCurrency(data.currency || 'USD');
      } catch (error) {
        setStatus({ type: 'error', message: error.message });
      } finally {
        setLoadingConfig(false);
      }
    };

    fetchConfig();
  }, []);

  const selectedPlan = useMemo(
    () => PLANS.find((plan) => plan.id === selectedPlanId) || null,
    [selectedPlanId]
  );

  const checkoutItems = useMemo(() => {
    if (!selectedPlan || selectedPlan.contactOnly) return [];
    const price = selectedPlan.pricing[billingPeriod];
    const items = [
      {
        id: selectedPlan.id,
        name: `${selectedPlan.name} (${BILLING_LABELS[billingPeriod]})`,
        price,
        quantity: 1,
      },
    ];

    const emailAmount = Math.max(Number(emailTopUp) || 0, 0);
    const planningAmount = Math.max(Number(planningTopUp) || 0, 0);

    if (emailAmount > 0) {
      items.push({
        id: 'topup-email',
        name: 'Email Credits Top-up',
        price: emailAmount,
        quantity: 1,
      });
    }

    if (planningAmount > 0) {
      items.push({
        id: 'topup-planning',
        name: 'Planning Credits Top-up',
        price: planningAmount,
        quantity: 1,
      });
    }

    return items;
  }, [selectedPlan, billingPeriod, emailTopUp, planningTopUp]);

  const orderTotal = useMemo(
    () => checkoutItems.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0),
    [checkoutItems]
  );

  const paypalOptions = useMemo(() => {
    if (!config?.clientId) return null;
    return {
      clientId: config.clientId,
      currency: config.currency,
      intent: 'capture',
    };
  }, [config]);

  const formatCurrency = (value) => {
    const activeCurrency = config?.currency || 'USD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: activeCurrency,
    }).format(value);
  };

  const handleSelectPlan = (planId) => {
    const plan = PLANS.find((p) => p.id === planId);
    if (plan?.contactOnly) {
      return;
    }
    setSelectedPlanId(planId);
    setSelectedGateway(null);
    setIsModalOpen(true);
  };

  const handleCardFocus = (planId) => {
    const plan = PLANS.find((p) => p.id === planId);
    if (plan?.contactOnly) return;
    setSelectedPlanId(planId);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedGateway(null);
  };

  const createOrder = async () => {
    if (checkoutItems.length === 0) {
      const message = 'Select a plan to continue.';
      setStatus({ type: 'error', message });
      throw new Error(message);
    }

    setStatus({ type: 'loading', message: 'Creating PayPal order...' });
    const response = await fetch(`${API_BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: checkoutItems }),
    });
    const data = await response.json();

    if (!response.ok) {
      const message = data?.message || 'Unable to create the order';
      setStatus({ type: 'error', message });
      throw new Error(message);
    }

    setStatus({ type: 'idle', message: '' });
    return data.id;
  };

  const captureOrder = async (orderId) => {
    setStatus({ type: 'loading', message: 'Capturing payment...' });
    const response = await fetch(`${API_BASE_URL}/api/orders/${orderId}/capture`, {
      method: 'POST',
    });
    const data = await response.json();

    if (!response.ok) {
      const message = data?.message || 'Unable to capture the order';
      setStatus({ type: 'error', message });
      throw new Error(message);
    }

    const payerName = data?.payer?.name?.given_name;
    setStatus({
      type: 'success',
      message: `Payment confirmed${payerName ? `. Thanks, ${payerName}!` : '!'}`,
    });
    return data;
  };

  const emailCreditsEarned = Math.max(Number(emailTopUp) || 0, 0) * 25;
  const planningCreditsEarned = Math.max(Number(planningTopUp) || 0, 0) * 5;

  const showPayPalInterface =
    isModalOpen && selectedGateway === 'paypal' && paypalOptions && checkoutItems.length > 0;

  const statusTone = STATUS_STYLES[status.type] || STATUS_STYLES.idle;

  return (
    <div className="flex min-h-screen w-full justify-center bg-[radial-gradient(circle_at_top,_#dbeafe_0%,_#eef2ff_45%,_#f8fafc_100%)] px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <main className="flex w-full max-w-5xl flex-col gap-8 rounded-3xl bg-white/90 p-6 shadow-[0_35px_60px_rgba(15,23,42,0.12)] backdrop-blur-sm sm:p-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-4">
            <p className="text-3xl font-semibold text-indigo-950">Upgrade Now</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                20% OFF
              </span>
              <div className="inline-flex items-center rounded-full border border-indigo-100 bg-white p-1 shadow-sm">
                {Object.entries(BILLING_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                      billingPeriod === key
                        ? 'bg-gradient-to-r from-indigo-500 to-indigo-700 text-white shadow-md'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                    onClick={() => setBillingPeriod(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
                <span>Currency</span>
                <select
                  id="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="rounded-full border border-indigo-100 bg-white px-4 py-1.5 text-sm font-semibold text-indigo-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value={config?.currency || 'USD'}>{config?.currency || 'USD'}</option>
                </select>
              </label>
            </div>
          </div>
          <button
            type="button"
            aria-label="Clear selection"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-lg font-semibold text-slate-600 transition hover:bg-slate-300"
            onClick={() => {
              setSelectedPlanId(null);
              setStatus({ type: 'idle', message: '' });
            }}
          >
            ×
          </button>
        </header>

        <section className="grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isSelected = selectedPlanId === plan.id;
            const priceLabel = plan.contactOnly
              ? ''
              : `${formatCurrency(plan.pricing[billingPeriod])} /Month`;

            return (
              <article
                key={plan.id}
                className={`flex flex-col gap-4 rounded-2xl border-2 bg-white p-6 shadow-inner transition hover:-translate-y-1 hover:shadow-lg ${
                  isSelected ? 'border-indigo-500 shadow-[0_25px_40px_rgba(91,75,255,0.15)]' : 'border-transparent'
                } ${plan.contactOnly ? 'cursor-default opacity-95' : 'cursor-pointer'}`}
                onClick={() => handleCardFocus(plan.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-indigo-950">{plan.name}</p>
                    {!plan.contactOnly && (
                      <>
                        <p className="text-2xl font-bold text-slate-900">{priceLabel}</p>
                        <p className="text-sm text-slate-500">{plan.meta}</p>
                      </>
                    )}
                  </div>
                  {plan.badge && (
                    <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-indigo-700">
                      {plan.badge}
                    </span>
                  )}
                </div>
                <ul className="space-y-3 text-sm text-slate-600">
                  {plan.credits.map((credit) => (
                    <li key={credit} className="flex items-start gap-2">
                      <span className="text-lg leading-5 text-green-500">✓</span>
                      <span>{credit}</span>
                    </li>
                  ))}
                </ul>
                <div className="pt-2">
                  {plan.contactOnly ? (
                    <a
                      href="mailto:sales@example.com"
                      className="text-sm font-semibold text-indigo-600 underline-offset-4 hover:underline"
                    >
                      Contact Sales
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="flex w-full items-center justify-center rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectPlan(plan.id);
                      }}
                    >
                      Select
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-indigo-950">Top up for Email Credits</h3>
            <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-slate-600">
              <span>Enter Amount (USD)</span>
              <input
                type="number"
                min="0"
                value={emailTopUp}
                onChange={(event) => setEmailTopUp(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-base font-semibold text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-bold text-indigo-600">*</span> Email Credits you get ={' '}
              <strong>{emailCreditsEarned}</strong>
            </p>
            <p className="text-xs text-slate-400">(1 USD = 25 Credits)</p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white/80 p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-indigo-950">Top up for Planning Credits</h3>
            <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-slate-600">
              <span>Enter Amount (USD)</span>
              <input
                type="number"
                min="0"
                value={planningTopUp}
                onChange={(event) => setPlanningTopUp(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-base font-semibold text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <p className="mt-3 text-sm text-slate-600">
              <span className="font-bold text-indigo-600">*</span> Planning Credits you get ={' '}
              <strong>{planningCreditsEarned}</strong>
            </p>
            <p className="text-xs text-slate-400">(1 USD = 5 Credits)</p>
          </article>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <label className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/80 p-5 text-sm font-medium text-slate-600">
            <span>Enter GST No.</span>
            <input
              type="text"
              placeholder="Enter GST No. (Optional)"
              value={gstNumber}
              onChange={(event) => setGstNumber(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white/80 p-5 text-sm font-medium text-slate-600">
            <span>Enter Promo code</span>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Enter Promo Code (Optional)"
                value={promoCode}
                onChange={(event) => setPromoCode(event.target.value)}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-base text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                className="rounded-2xl border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
              >
                Apply
              </button>
            </div>
          </label>
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white/80 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Total due</p>
            <p className="text-3xl font-bold text-slate-900">
              {orderTotal > 0 ? formatCurrency(orderTotal) : '—'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-2xl bg-gradient-to-r from-indigo-500 to-indigo-700 px-8 py-3 text-base font-semibold text-white shadow-lg transition hover:from-indigo-600 hover:to-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-400 disabled:text-slate-100 disabled:shadow-none"
            onClick={() => {
              if (selectedPlanId) {
                setSelectedGateway(null);
                setIsModalOpen(true);
              } else {
                setStatus({ type: 'warning', message: 'Select a plan before paying.' });
              }
            }}
            disabled={!selectedPlanId || selectedPlan?.contactOnly}
          >
            Pay Now
          </button>
        </section>

        {status.message && !isModalOpen && (
          <p className={`rounded-2xl border px-4 py-3 text-sm font-medium ${statusTone}`}>
            {status.message}
          </p>
        )}
      </main>

      {isModalOpen && selectedPlan && !selectedPlan.contactOnly && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 px-4 py-8 text-slate-900"
          onClick={closeModal}
        >
          <div
            className="relative w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-8"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-600 transition hover:bg-slate-200"
              onClick={closeModal}
            >
              ×
            </button>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gateway Selection</p>
            <h3 className="mt-2 text-2xl font-semibold text-indigo-950">Choose a payment gateway</h3>
            <p className="mt-1 text-sm text-slate-600">
              {selectedPlan.name} · {formatCurrency(selectedPlan.pricing[billingPeriod])}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-2xl border px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 ${
                  selectedGateway === 'paypal'
                    ? 'border-indigo-500 bg-indigo-50 shadow'
                    : 'border-slate-200 bg-white hover:border-indigo-300'
                }`}
                onClick={() => setSelectedGateway('paypal')}
              >
                <strong className="block text-base font-semibold text-indigo-950">PayPal</strong>
                <span className="text-sm text-slate-500">Pay securely with PayPal</span>
              </button>
              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left text-slate-400 opacity-60"
                disabled
              >
                <strong className="block text-base font-semibold">Razorpay</strong>
                <span className="text-sm">Coming soon</span>
              </button>
            </div>

            {selectedGateway === 'paypal' && (
              <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                {loadingConfig && <p className="text-sm text-slate-500">Loading PayPal configuration...</p>}
                {!loadingConfig && !paypalOptions && (
                  <p className="text-sm text-rose-600">
                    Unable to load PayPal credentials. Double-check your backend configuration.
                  </p>
                )}
                {showPayPalInterface && (
                  <PayPalScriptProvider options={paypalOptions}>
                    <PayPalButtons
                      style={{ layout: 'vertical', shape: 'rect', label: 'pay' }}
                      createOrder={createOrder}
                      onApprove={async (data) => {
                        if (data?.orderID) {
                          await captureOrder(data.orderID);
                          closeModal();
                        }
                      }}
                      onError={(error) =>
                        setStatus({ type: 'error', message: error?.message || 'PayPal error' })
                      }
                      onCancel={() =>
                        setStatus({ type: 'warning', message: 'Checkout cancelled by the shopper.' })
                      }
                      forceReRender={[orderTotal, billingPeriod, selectedPlanId]}
                    />
                  </PayPalScriptProvider>
                )}
              </div>
            )}

            {status.message && (
              <p className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-medium ${statusTone}`}>
                {status.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
