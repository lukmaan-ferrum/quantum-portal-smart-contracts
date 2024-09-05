import hre from "hardhat"
import deployModule from "./modules/QPDeploy"
import fs from "fs"
import yaml from "js-yaml"
import { loadQpDeployConfig, QpDeployConfig } from "../scripts/utils/DeployUtils";
import { Contract } from "ethers";
const DEFAULT_QP_CONFIG_FILE = 'QpDeployConfig.yaml';




async function main() {
    const conf: QpDeployConfig = loadQpDeployConfig(process.env.QP_CONFIG_FILE || DEFAULT_QP_CONFIG_FILE);
    let gateway,
        ledgerMgr,
        poc,
        authMgr,
        feeConverterDirect,
        staking,
        minerMgr,
        owner,
        signer1,
        signer2,
        signer3,
        signer4,
        signer5,
        signer6,
        signer7,
        dev,
        settings
    
    ({ gateway, ledgerMgr, poc, authMgr, feeConverterDirect, staking, minerMgr } = await hre.ignition.deploy(deployModule))

    settings  = [{
        quorumId: await gateway.BETA_QUORUMID(),
        target: poc.target,
        funcSelector: poc!.interface!.getFunction("setFeeToken", ["address"]).selector,
    },
    {
        quorumId: await gateway.PROD_QUORUMID(),
        target: ledgerMgr.target,
        funcSelector: ledgerMgr.interface.getFunction("updateLedger", ["address"]).selector,
    },
    {
        quorumId: await gateway.TIMELOCKED_PROD_QUORUMID(),
        target: ledgerMgr.target,
        funcSelector: ledgerMgr.interface.getFunction("updateMinerMgr", ["address"]).selector,
    }]

    await gateway.setCallAuthLevels(settings)

    conf.QuantumPortalGateway = gateway.target as string
    conf.QuantumPortalPoc = poc.target as string
    conf.QuantumPortalLedgerMgr = ledgerMgr.target as string
    conf.QuantumPortalAuthorityMgr = authMgr.target as string
    conf.QuantumPortalFeeConvertorDirect = feeConverterDirect.target as string
    conf.QuantumPortalMinerMgr = minerMgr.target as string
    conf.QuantumPortalStake = staking.target as string
    
    const updatedConf = yaml.dump(conf);

    fs.writeFileSync(DEFAULT_QP_CONFIG_FILE, updatedConf, 'utf8');
}


main()
.then(() => process.exit(0))
.catch((error) => {
    console.error(error)
    process.exit(1)
})
