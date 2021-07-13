import fc from 'fast-check'
import { fica } from '../data/federal'
import F1040 from '../irsForms/F1040'
import F8959 from '../irsForms/F8959'
import Form from '../irsForms/Form'
import Schedule2 from '../irsForms/Schedule2'
import Schedule3 from '../irsForms/Schedule3'
import * as arbitraries from './arbitraries'

function hasSSRefund (f1040: F1040): boolean {
  const s3 = f1040.schedule3
  const l10 = s3?.l10()
  return l10 !== undefined && l10 > 0
}

function hasAdditionalMedicareTax (f1040: F1040): boolean {
  const s2 = f1040.schedule2
  const l8 = s2?.l8()
  return l8 !== undefined && l8 > 0
}

type Constructor<T> = new (...args: any[]) => T
function hasAttachment<FormType> (attachments: Form[], formType: Constructor<FormType>): boolean {
  return attachments.find((f) => { return f instanceof formType }) !== undefined
}

describe('fica', () => {
  it('should give refund SS tax overpayment only in some conditions', () => {
    fc.assert(
      fc.property(arbitraries.f1040, ([f1040, forms]) => {
        if (f1040.w2s.length <= 1) {
          // Should never give SS refund with 1 or fewer W2s
          expect(!hasSSRefund(f1040))
        } else {
          if (f1040.wages() <= fica.maxIncomeSSTaxApplies ||
            f1040.w2s.some((w2) => w2.ssWithholding > fica.maxSSTax)) {
            // Should never give SS refund if W2 income below max threshold, or
            // some W2 has withheld over the max.
            expect(!hasSSRefund(f1040))
          } else {
            // Otherwise, should always give SS refund, and attach schedule 3
            expect(hasSSRefund(f1040))
            expect(hasAttachment(forms, Schedule3))
          }
        }
      })
    )
  })

  it('should give SS refund based on filing status', () => {
    fc.assert(
      fc.property(arbitraries.f1040, ([f1040, forms]) => {
        if (hasSSRefund(f1040)) {
          const s3l10 = f1040.schedule3?.l10()
          expect(s3l10 !== undefined && s3l10 > 0)

          const ssWithheld = f1040.w2s.map((w2) => w2.ssWithholding).reduce((l, r) => l + r, 0)
          expect(s3l10 === (ssWithheld - fica.maxSSTax))
        }
      })
    )
  })

  it('should add Additional Medicare Tax form 8959', () => {
    fc.assert(
      fc.property(arbitraries.f1040, ([f1040, forms]) => {
        if (f1040.filingStatus === undefined) {
          return
        }
        const filingStatus = f1040.filingStatus
        // Should add Additional Medicare Tax iff wages over threshold
        if (f1040.wages() > fica.additionalMedicareTaxThreshold(filingStatus)) {
          expect(hasAdditionalMedicareTax(f1040))

          // Should attach both S2 and F8959 to return
          expect(hasAttachment(forms, Schedule2))
          expect(hasAttachment(forms, F8959))
        } else {
          expect(!hasAdditionalMedicareTax(f1040))
          expect(!hasAttachment(forms, F8959))
        }
      })
    )
  })

  it('should add Additional Medicare Tax based on filing status', () => {
    fc.assert(
      fc.property(arbitraries.f1040, ([f1040, forms]) => {
        if (f1040.filingStatus === undefined) {
          return
        }
        if (hasAdditionalMedicareTax(f1040)) {
          const filingStatus = f1040.filingStatus
          const incomeOverThreshold = f1040.wages() - fica.additionalMedicareTaxThreshold(filingStatus)
          expect(incomeOverThreshold > 0)

          // Adds the right amount of additional tax
          const s2l8 = f1040.schedule2?.l8()
          expect(s2l8 !== undefined && s2l8 === incomeOverThreshold * fica.additionalMedicareTaxRate)

          // Also adds in the extra Medicare tax withheld to 1040 taxes already paid
          const medicareWithheld = f1040.w2s.map((w2) => w2.medicareWithholding).reduce((l, r) => l + r, 0)
          const regularWithholding = fica.additionalMedicareTaxThreshold(filingStatus) * fica.regularMedicareTaxRate
          if (medicareWithheld > regularWithholding) {
            const additionalWithheld = medicareWithheld - regularWithholding
            const f1040l25c = f1040.l25c()
            expect(f1040l25c !== undefined && f1040l25c === additionalWithheld)
          }
        }
      })
    )
  })
})
