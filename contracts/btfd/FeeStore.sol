pragma solidity ^0.8.24;

import "./ITokenFactory.sol";
import "./IFeeStore.sol";
import "../quantumPortal/poc/IQuantumPortalPoc.sol";
import "../quantumPortal/poc/poa/IQuantumPortalFeeConvertor.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "foundry-contracts/contracts/contracts/math/FullMath.sol";

error OnlyFactory();
error OnlyBtc();
error CouldNotSendFee(uint amount);

contract FeeStore is IFeeStore {
    using SafeERC20 for IERC20;
    ITokenFactory immutable public factory;
    mapping(bytes32 => uint) collectedFee;

    constructor() {
        factory = ITokenFactory(msg.sender);
    }

    function sweepToken(address token, uint amount, address to) external {
        if (msg.sender != address(factory)) { revert OnlyFactory(); }
        IERC20(token).safeTransfer(to, amount);
    }
    
    /**
     * @notice Called by rune token to send fee to QP fee target
     */
    function collectFee(bytes32 txId) external returns (uint amount) {
        if (msg.sender != address(factory)) { revert OnlyFactory(); }
        amount = collectedFee[txId];
        if (amount != 0) {
            IQuantumPortalPoc portal = IQuantumPortalPoc(factory.portal());
            try IERC20(portal.feeToken()).transfer(portal.feeTarget(), amount) {
                delete collectedFee[txId];
            } catch {
                revert CouldNotSendFee(amount);
            }
        }
    }

    /**
     * @notice Called by BTC token to save fees for Rune processing.
     * Any BTC that has no inscription is assumed to be QP fee.
     */
    function swapBtcWithFee(bytes32 txId, uint btcAmount) external override {
        if (msg.sender != factory.btc()) { revert OnlyBtc(); }
        // Price of FRM based on BTC
        uint256 gasTokenPrice = IQuantumPortalFeeConvertor(factory.feeConvertor())
            .localChainGasTokenPrice();
        uint256 txGas = btcAmount / gasTokenPrice;
        collectedFee[txId] = txGas;
    }
}
