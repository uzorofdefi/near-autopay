import { NearBindgen, near, call, view, initialize, assert } from 'near-sdk-js';

@NearBindgen({})
class AutoPayTreasury {
    owner_id: string = "";
    agent_id: string = "";

    @initialize({})
    init({ owner_id, agent_id }: { owner_id: string, agent_id: string }) {
        this.owner_id = owner_id;
        this.agent_id = agent_id;
        near.log(`Treasury initialized. Owner: ${owner_id}, Agent: ${agent_id}`);
    }

    @call({ payableFunction: true })
    deposit() {
        const amount = near.attachedDeposit();
        assert(amount > BigInt(0), "Deposit must be greater than zero");
        near.log(`Deposited ${amount.toString()} yoctoNEAR into the treasury.`);
    }

    @call({})
    batch_payout({ payouts }: { payouts: { account_id: string, amount: string }[] }) {
        const caller = near.predecessorAccountId();
        
        assert(
            caller === this.agent_id || caller === this.owner_id, 
            "Unauthorized: Only the designated agent can execute payroll."
        );

        for (const payout of payouts) {
            const amountInYocto = BigInt(payout.amount);
            const promiseIndex = near.promiseBatchCreate(payout.account_id);
            near.promiseBatchActionTransfer(promiseIndex, amountInYocto);
        }
        
        near.log(`Successfully executed batch payout to ${payouts.length} accounts.`);
    }

    @view({})
    get_config(): { owner_id: string, agent_id: string } {
        return { owner_id: this.owner_id, agent_id: this.agent_id };
    }
}