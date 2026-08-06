/**
 * from Paper
 * https://app.paper.design/file/01KTVW7BP98EVMSBJHSWY56FZ0/3-0/3HB-0
 * on Aug 6, 2026
 *
 * Reference-only export of the target soft design (Billing & Invoices page,
 * including the app shell: topbar + sidebar). Not imported anywhere; see
 * soft-tokens.md for the distilled token sheet.
 */
export default function () {
  return (
    <div className="[font-synthesis:none] flex overflow-clip w-360 h-fit flex-col bg-[#FAFAFA] antialiased">
      <div className="w-full flex items-center justify-between h-18 shrink-0 px-6 bg-white border-b border-b-solid border-b-[#E8E8EC]">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center shrink-0 rounded-[9px] bg-[#FF6600] size-8">
            <div className="font-['Inter_Tight',system-ui,sans-serif] font-bold text-white text-[17px]/5">
              S
            </div>
          </div>
          <div className="tracking-[-0.03em] font-['Inter_Tight',system-ui,sans-serif] font-bold text-[#131315] text-[22px]/6.5">
            snip.
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="w-max shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
            Home / Billing &amp; Invoices
          </div>
          <div className="w-7.5 h-7.5 shrink-0 rounded-[999px] bg-[#DCE2F7]" />
        </div>
      </div>
      <div className="w-full flex">
        <div className="w-58 shrink-0 flex flex-col justify-between py-6 px-4 bg-white border-r border-r-solid border-r-[#E8E8EC]">
          <div className="flex flex-col gap-1">
            <div className="pt-1.5 pb-2.5 px-2.5">
              <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#A0A0A5] text-[13px]/4.5">
                Projects
              </div>
            </div>
            <div className="py-2.25 px-2.5">
              <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-[15px]/5.5">
                Summer campaign
              </div>
            </div>
            <div className="py-2.25 px-2.5">
              <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-[15px]/5.5">
                Studio archive
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="p-2.5 rounded-[10px] bg-[#FFF0E6]">
              <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#D14E00] text-[15px]/5.5">
                Billing &amp; Invoices
              </div>
            </div>
            <div className="p-2.5">
              <div className="font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#6E6E73] text-[15px]/5.5">
                Team members
              </div>
            </div>
            <div className="p-2.5">
              <div className="font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#6E6E73] text-[15px]/5.5">
                Settings
              </div>
            </div>
          </div>
        </div>
        <div className="grow flex flex-col pt-10 pb-16 gap-3.5 px-14 bg-[#FAFAFA]">
          <div className="w-full pb-2">
            <div className="tracking-[-0.02em] font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-[22px]/7">
              Billing &amp; Invoices
            </div>
          </div>
          <div className="w-full flex items-start justify-between py-5.5 px-6 rounded-[14px] gap-6 bg-white border border-solid border-[#E8E8EC]">
            <div className="flex flex-col gap-1.25">
              <div className="flex items-center gap-2.25">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-base/5.5">
                  Pro
                </div>
                <div className="py-0.5 px-2.25 rounded-[999px] bg-[#F1F1F3]">
                  <div className="font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#6E6E73] text-xs/4.5">
                    Monthly
                  </div>
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  $50 / mo.
                </div>
              </div>
              <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                2 TB of storage, unlimited collaborators, paid delivery.
              </div>
              <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#A0A0A5] text-sm/5">
                Renews on August 12, 2026.
              </div>
            </div>
            <div className="flex items-start gap-3 flex-col">
              <div className="py-1.75 px-3.5 rounded-[999px] flex flex-col items-center gap-1.75 justify-center self-stretch bg-white border border-solid border-[#D8D8DE]">
                <div className="w-max font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-[13px]/4.5">
                  Adjust plan
                </div>
              </div>
            </div>
          </div>
          <div className="w-full flex flex-col py-5.5 px-6 rounded-[14px] gap-3.5 bg-white border border-solid border-[#E8E8EC]">
            <div className="w-full flex items-center justify-between gap-6">
              <div className="flex flex-col gap-1">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-base/5.5">
                  Invoices
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  What you paid Snip.
                </div>
              </div>
              <div className="flex items-center shrink-0 py-1.75 px-3.25 rounded-[999px] gap-1.75 bg-white border border-solid border-[#D8D8DE]">
                <div className="w-max shrink-0 font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-[13px]/4.5">
                  Last 6 months
                </div>
              </div>
            </div>
            <div className="w-full flex flex-col">
              <div className="w-full flex items-center pb-2.25">
                <div className="w-32.5 shrink-0 tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  DATE
                </div>
                <div className="grow tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  DESCRIPTION
                </div>
                <div className="w-27.5 shrink-0 tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  STATUS
                </div>
                <div className="w-30 shrink-0 text-right tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#A0A0A5] text-[11px]/3.5">
                  AMOUNT
                </div>
                <div className="w-20 shrink-0 text-right tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#A0A0A5] text-[11px]/3.5">
                  INVOICE
                </div>
              </div>
              <div className="w-full flex items-center py-3 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-32.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Aug 12, 2026
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  Pro plan, Aug 12 to Sep 12
                </div>
                <div className="w-27.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Paid
                </div>
                <div className="w-30 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] flex justify-end flex-wrap text-[#131315] text-sm/5">
                  50.00 USD
                </div>
                <div className="w-20 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#131315] text-sm/5">
                  View
                </div>
              </div>
              <div className="w-full flex items-center py-3 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-32.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Jul 12, 2026
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  Pro plan, Jul 12 to Aug 12
                </div>
                <div className="w-27.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Paid
                </div>
                <div className="w-30 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] flex justify-end flex-wrap text-[#131315] text-sm/5">
                  50.00 USD
                </div>
                <div className="w-20 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#131315] text-sm/5">
                  View
                </div>
              </div>
            </div>
          </div>
          <div className="w-271.75 h-0.5 shrink-0 bg-[#DDDDDD]" />
          <div className="w-full flex flex-col py-5.5 px-6 rounded-[14px] gap-3.5 bg-white border border-solid border-[#E8E8EC]">
            <div className="w-full flex items-center justify-between gap-6">
              <div className="flex flex-col gap-1">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-base/5.5">
                  Paid to you
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  What clients paid for your files, minus the 5% + 30&cent; fee.
                </div>
              </div>
              <div className="flex items-center shrink-0 py-1.75 px-3.25 rounded-[999px] gap-1.75 bg-white border border-solid border-[#D8D8DE]">
                <div className="w-max shrink-0 font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-[13px]/4.5">
                  Last 6 months
                </div>
              </div>
            </div>
            <div className="w-full flex flex-col">
              <div className="w-full flex items-center pb-2.25">
                <div className="w-32.5 shrink-0 tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  DATE
                </div>
                <div className="grow tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  FILE
                </div>
                <div className="w-27.5 shrink-0 tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  PAID OUT
                </div>
                <div className="w-30 shrink-0 text-right tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#A0A0A5] text-[11px]/3.5">
                  YOU GET
                </div>
                <div className="w-20 shrink-0 text-right tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#A0A0A5] text-[11px]/3.5">
                  RECEIPT
                </div>
              </div>
              <div className="w-full flex items-center py-3 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-32.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Aug 1, 2026
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  Summer campaign, final cut
                </div>
                <div className="w-27.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#D14E00] text-sm/5">
                  Held
                </div>
                <div className="w-30 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] flex justify-end flex-wrap text-[#131315] text-sm/5">
                  1,139.70 USD
                </div>
                <div className="w-20 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#131315] text-sm/5">
                  View
                </div>
              </div>
              <div className="w-full flex items-center py-3 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-32.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Jul 28, 2026
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  Studio archive, gallery
                </div>
                <div className="w-27.5 shrink-0 font-['Inter_Tight',system-ui,sans-serif] text-[#D14E00] text-sm/5">
                  Held
                </div>
                <div className="w-30 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] flex justify-end flex-wrap text-[#131315] text-sm/5">
                  379.70 USD
                </div>
                <div className="w-20 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] font-medium flex justify-end flex-wrap text-[#131315] text-sm/5">
                  View
                </div>
              </div>
              <div className="w-full flex items-center pt-3.5 border-t border-t-solid border-t-[#E8E8EC]">
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-sm/5">
                  Waiting on Stripe verification
                </div>
                <div className="w-30 shrink-0 text-right font-['Inter_Tight',system-ui,sans-serif] font-semibold flex justify-end flex-wrap text-[#131315] text-[15px]/5.5">
                  1,519.40 USD
                </div>
                <div className="w-20 shrink-0" />
              </div>
            </div>
          </div>
          <div className="w-full flex flex-col py-5.5 px-6 rounded-[14px] gap-4 bg-white border border-solid border-[#E8E8EC]">
            <div className="w-full flex items-start justify-between gap-6">
              <div className="flex flex-col gap-1">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-semibold text-[#131315] text-base/5.5">
                  Getting paid
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-sm/5">
                  Set up Stripe once. Clients pay through your share links, Stripe pays you out.
                </div>
              </div>
              <div className="shrink-0 py-1.75 px-3.5 rounded-[999px] bg-[#131315]">
                <div className="w-max font-['Inter_Tight',system-ui,sans-serif] font-medium text-white text-[13px]/4.5">
                  Finish setup
                </div>
              </div>
            </div>
            <div className="w-full flex items-center py-3.5 px-4 rounded-[11px] bg-[#FAFAFA] border border-solid border-[#E8E8EC]">
              <div className="grow flex flex-col gap-0.5">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-sm/5">
                  Payments
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#D14E00] text-[13px]/4.5">
                  Active
                </div>
              </div>
              <div className="w-px h-8.5 shrink-0 bg-[#E8E8EC]" />
              <div className="grow flex flex-col pl-4 gap-0.5">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-sm/5">
                  Payouts
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-[13px]/4.5">
                  Held by Stripe
                </div>
              </div>
              <div className="w-px h-8.5 shrink-0 bg-[#E8E8EC]" />
              <div className="grow flex flex-col pl-4 gap-0.5">
                <div className="font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#131315] text-sm/5">
                  Collected so far
                </div>
                <div className="font-['Inter_Tight',system-ui,sans-serif] text-[#6E6E73] text-[13px]/4.5">
                  $1,600.00
                </div>
              </div>
            </div>
            <div className="w-full flex flex-col">
              <div className="w-full flex items-center pb-2.25">
                <div className="grow tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  STRIPE STILL NEEDS
                </div>
                <div className="tracking-widest font-['Geist_Mono',system-ui,sans-serif] font-medium text-[#A0A0A5] text-[11px]/3.5">
                  DUE
                </div>
              </div>
              <div className="w-full flex items-center py-2.75 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-5 shrink-0 flex items-center">
                  <div className="rounded-[999px] shrink-0 bg-[#D8434F] size-1.5" />
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  A photo of your ID
                </div>
                <div className="w-max shrink-0 font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#D8434F] text-[13px]/4.5">
                  Past due
                </div>
              </div>
              <div className="w-full flex items-center py-2.75 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-5 shrink-0 flex items-center">
                  <div className="rounded-[999px] shrink-0 bg-[#D39329] size-1.5" />
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  A bank account to pay into
                </div>
                <div className="w-max shrink-0 font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#6E6E73] text-[13px]/4.5">
                  Now
                </div>
              </div>
              <div className="w-full flex items-center py-2.75 border-t border-t-solid border-t-[#F1F1F3]">
                <div className="w-5 shrink-0 flex items-center">
                  <div className="rounded-[999px] shrink-0 bg-[#D39329] size-1.5" />
                </div>
                <div className="grow font-['Inter_Tight',system-ui,sans-serif] text-[#131315] text-sm/5">
                  Your business address
                </div>
                <div className="w-max shrink-0 font-['Inter_Tight',system-ui,sans-serif] font-medium text-[#6E6E73] text-[13px]/4.5">
                  Now
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
