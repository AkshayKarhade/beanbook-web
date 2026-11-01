import { Link } from 'react-router-dom';

const features = [
  { icon: '◫', title: 'Live order tracking', description: 'Follow active orders through preparation and service, with clear payment status.' },
  { icon: '▤', title: 'Flexible billing', description: 'Support pay-first and open-bill workflows, including adding items before settlement.' },
  { icon: '♙', title: 'Customer relationships', description: 'Understand repeat customers, order history and lifetime paid value.' },
  { icon: '▦', title: 'Products & menus', description: 'Organize your catalogue and menus for your business.' },
  { icon: '✉', title: 'Receipts made simple', description: 'Print customer bills or email them directly from the order.' },
  { icon: '⌁', title: 'Payment options', description: 'Manage cash and self-UPI counter settlements; payment gateway availability varies by flow.' },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#faf7f2] text-[#34271f]">
      <header className="border-b border-[#e9ded2] bg-[#fffdf9]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5">
          <Link to="/" className="text-2xl font-extrabold tracking-tight">BeanBook<span className="text-[#ae8063]">.</span></Link>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <a href="#features" className="hover:text-[#a36e50]">Features</a>
            <a href="#roadmap" className="hover:text-[#a36e50]">Roadmap</a>
            <a href="#pricing" className="hover:text-[#a36e50]">Pricing</a>
            <Link to="/admin" className="rounded-xl bg-[#4a3026] px-4 py-2.5 text-white hover:bg-[#654639]">Business sign in</Link>
          </div>
        </div>
      </header>
      <main>
        <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#9d7056]">Made for hospitality</p>
            <h1 className="mt-5 text-5xl font-extrabold leading-tight tracking-tight sm:text-6xl">Run your business. <span className="text-[#a97855]">Beautifully simple.</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-[#75645a]">Orders, menus, customers and payments — one calm workspace for the people behind cafés, carts and growing food businesses.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="mailto:the8thcoffeebean@gmail.com?subject=BeanBook%20pilot%20enquiry" className="rounded-xl bg-[#4a3026] px-6 py-3 font-semibold text-white hover:bg-[#654639]">Enquire about a pilot</a>
              <Link to="/admin" className="rounded-xl border border-[#d6c5b7] bg-white px-6 py-3 font-semibold hover:bg-[#f3e9df]">Business sign in</Link>
            </div>
            <p className="mt-4 text-sm text-[#8b7a70]">Early access for selected businesses. No self-service subscription checkout yet.</p>
          </div>
          <div className="rounded-[2rem] border border-[#e7d7c8] bg-[#f0e2d3] p-5 shadow-sm">
            <div className="rounded-3xl bg-[#fffdf9] p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#a97855]">One workspace</p>
              <h2 className="mt-3 text-2xl font-bold">Less admin. More hospitality.</h2>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {['Live orders','Customer insights','Products & menus','Flexible billing'].map((item,i)=><div key={item} className={['bg-[#f4e8dc]','bg-[#e8efe4]','bg-[#f4e8ef]','bg-[#f5efd9]'][i]+' rounded-2xl p-5 text-sm font-semibold'}>{item}</div>)}
              </div>
              <p className="mt-6 text-sm leading-6 text-[#75645a]">A simple home for the daily work that keeps your business moving.</p>
            </div>
          </div>
        </section>
        <section id="features" className="bg-white py-20">
          <div className="mx-auto max-w-6xl px-5">
            <p className="text-xs font-bold uppercase tracking-widest text-[#a97855]">What BeanBook does today</p>
            <h2 className="mt-3 text-3xl font-bold">The essentials, thoughtfully connected.</h2>
            <div className="mt-9 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map(f=><article key={f.title} className="rounded-2xl border border-[#ebdfd4] bg-[#fffdf9] p-6"><span className="text-3xl text-[#a97855]">{f.icon}</span><h3 className="mt-4 text-lg font-bold">{f.title}</h3><p className="mt-2 text-sm leading-6 text-[#75645a]">{f.description}</p></article>)}
            </div>
          </div>
        </section>
        <section id="roadmap" className="mx-auto max-w-6xl px-5 py-20">
          <p className="text-xs font-bold uppercase tracking-widest text-[#a97855]">What's next</p>
          <h2 className="mt-3 text-3xl font-bold">Growing alongside your business.</h2>
          <p className="mt-4 max-w-2xl text-[#75645a]">We're working toward richer reporting, inventory workflows, multi-location operations and more payment integrations. These are planned capabilities, not features available in the current pilot.</p>
        </section>
        <section id="pricing" className="bg-[#f1e7dd] py-20">
          <div className="mx-auto max-w-6xl px-5">
            <p className="text-xs font-bold uppercase tracking-widest text-[#93674e]">Early access pricing</p>
            <h2 className="mt-3 text-3xl font-bold">Straightforward pricing, as we grow.</h2>
            <p className="mt-4 max-w-2xl text-[#75645a]">Indicative pricing per login user, per month. Final features, taxes and commercial terms will be confirmed before paid subscriptions begin.</p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[{name:'Base',price:'₹499',text:'Menu, billing and event management',details:'Core tools for daily operations.'},{name:'Growth',price:'₹999',text:'Everything in Base, plus more',details:'Ledger inventory management, customer management and business analytics (advanced capabilities planned).'},{name:'Complete',price:'₹1,499',text:'The full BeanBook suite',details:'Early access to new features, multi-team and multi-location operations, and advanced inventory for complex recipes (planned).'}].map(p=><div key={p.name} className="rounded-3xl border border-[#e6d7c8] bg-white p-7"><h3 className="text-lg font-bold">{p.name}</h3><p className="mt-5 text-4xl font-extrabold">{p.price}{p.price!=='Custom'&&<span className="text-sm font-normal text-[#86766a]"> / login user / month</span>}</p><p className="mt-3 font-medium">{p.text}</p><p className="mt-3 text-sm leading-6 text-[#75645a]">{p.details}</p><a href="mailto:the8thcoffeebean@gmail.com?subject=BeanBook%20pricing%20enquiry" className="mt-7 inline-block rounded-xl border border-[#cdb9a7] px-5 py-3 text-sm font-semibold hover:bg-[#faf4ee]">Contact us</a></div>)}
            </div>
            <p className="mt-5 text-sm text-[#75645a]">Pilot participation is by invitation. Pricing is not yet active and no payment is collected on this page.</p>
          </div>
        </section>
      </main>
      <footer className="border-t border-[#e9ded2] bg-[#fffdf9] px-5 py-8 text-center text-sm text-[#806f64]">© BeanBook · Built for the people behind great hospitality.</footer>
    </div>
  );
}
